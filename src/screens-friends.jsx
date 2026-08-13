/* Friends and social preview. The screen is intentionally feature-gated by
   settings.showFriendsTab and only receives the social store slice when that
   gate is on. */

const { useState: useStateF, useEffect: useEffectF, useMemo: useMemoF } = React;

const SOCIAL_INPUT_STYLE = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px',
  borderRadius: 5, border: `var(--hair-width) solid ${UI.hairStrong}`,
  background: UI.bgInset, color: UI.ink, fontFamily: UI.fontUi,
  fontSize: 13, outline: 'none', userSelect: 'text', WebkitUserSelect: 'text',
};

function socialMetricLabel(metric) {
  return metric === 'steps' ? 'Steps' : metric === 'workouts' ? 'Workouts' : 'Adherence';
}

function socialMetricValue(metric, value) {
  if (value == null) return null;
  if (metric === 'steps') return `${Number(value).toLocaleString()} steps`;
  if (metric === 'workouts') return `${value} workouts`;
  return `${value}% adherence`;
}

function socialTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function socialDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

function socialInitials(name) {
  const parts = String(name || 'Zane athlete').trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map(part => part[0]).join('') || 'Z').toUpperCase();
}

function SocialWorkoutSheet({ workout, onClose }) {
  const [detail, setDetail] = useStateF(null);
  const [loading, setLoading] = useStateF(true);
  const [error, setError] = useStateF('');
  const [comment, setComment] = useStateF('');
  const [sending, setSending] = useStateF(false);
  const [commentsOpen, setCommentsOpen] = useStateF(false);

  const load = async () => {
    try {
      const next = await LB.loadSocialWorkoutDetail(workout.ownerId, workout.sessionId);
      setDetail(next);
      setError(next ? '' : 'This workout is no longer available.');
    } catch (e) {
      setError(e.message || 'Could not load workout');
    } finally {
      setLoading(false);
    }
  };

  useEffectF(() => {
    let live = true;
    const run = () => { if (live) load(); };
    run();
    const interval = setInterval(run, workout.live ? 2000 : 10000);
    return () => { live = false; clearInterval(interval); };
  }, [workout.ownerId, workout.sessionId, workout.live]);

  const send = async (body, kind = 'comment') => {
    const text = String(body || '').trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const next = await LB.sendSocialWorkoutComment(workout.sessionId, text, kind);
      setDetail(current => current ? { ...current, comments: [...(current.comments || []), next] } : current);
      setComment('');
    } catch (e) {
      setError(e.message || 'Could not send comment');
    } finally {
      setSending(false);
    }
  };

  const session = detail?.session || workout;
  const entries = detail?.entries || [];
  const doneSets = Number(session.setsDone || 0);
  const totalSets = Number(session.setsTotal || 0);
  const progress = totalSets > 0 ? Math.min(1, doneSets / totalSets) : 0;
  const live = !session.ended;

  return (
    <Sheet open onClose={onClose} title={session.ownerName || 'Workout'} titleRight={
      <span className="micro" style={{ color: live ? UI.gold : UI.inkFaint }}>{live ? 'LIVE' : 'FINISHED'}</span>
    }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div className="display" style={{ color: UI.ink, fontSize: 24 }}>{session.dayName || 'Workout'}</div>
          <div className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>{socialDate(session.startedAt || session.date)}</div>
        </div>
        <Card style={{ padding: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
            <span className="micro" style={{ color: UI.inkFaint }}>{live ? 'WORKING THROUGH IT' : 'WORKOUT COMPLETE'}</span>
            <span className="num" style={{ color: UI.gold, fontSize: 13 }}>{doneSets} / {totalSets || '—'} SETS</span>
          </div>
          <div style={{ height: 6, borderRadius: 99, background: UI.bgInset, overflow: 'hidden', marginTop: 10 }}>
            <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, background: UI.gold, transition: 'width .25s ease' }} />
          </div>
          {live && <div className="micro" style={{ color: UI.inkFaint, marginTop: 8 }}>Live progress refreshes automatically.</div>}
        </Card>
        {loading && !detail && <div className="micro" style={{ color: UI.inkFaint, textAlign: 'center', padding: 16 }}>LOADING WORKOUT…</div>}
        {error && <div style={{ padding: '9px 11px', borderRadius: 5, background: 'rgba(var(--danger-rgb),0.10)', border: `var(--hair-width) solid rgba(var(--danger-rgb),0.3)`, color: UI.danger, fontFamily: UI.fontUi, fontSize: 12 }}>{error}</div>}
        {entries.length > 0 && <div>
          <div className="micro" style={{ color: UI.gold, marginBottom: 8 }}>EXERCISES</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {entries.map((entry, index) => {
              const sets = entry.sets || [];
              const done = sets.filter(set => set.done || set.skipped).length;
              const complete = sets.length > 0 && done === sets.length;
              return <Card key={`${entry.name}-${index}`} style={{ padding: 12, background: complete ? 'rgba(var(--accent-rgb),0.08)' : UI.bgRaised }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>{String(index + 1).padStart(2, '0')}</span>
                  <span style={{ flex: 1, color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>{entry.name}</span>
                  <span className="num" style={{ color: complete ? UI.gold : UI.inkFaint, fontSize: 11 }}>{done}/{sets.length || entry.plannedSets || '—'}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {sets.map((set, setIndex) => <span key={setIndex} title={set.skipped ? 'Skipped' : set.done ? 'Done' : 'Planned'} style={{ width: 18, height: 18, borderRadius: 4, display: 'grid', placeItems: 'center', border: `var(--hair-width) solid ${set.done ? UI.gold : set.skipped ? UI.inkGhost : UI.hairStrong}`, background: set.done ? UI.goldFaint : 'transparent', color: set.done ? UI.gold : UI.inkGhost, fontFamily: UI.fontNum, fontSize: 9 }}>{set.skipped ? '—' : set.done ? '✓' : setIndex + 1}</span>)}
                </div>
              </Card>;
            })}
          </div>
        </div>}
        <button type="button" onClick={() => setCommentsOpen(open => !open)} aria-expanded={commentsOpen} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 11px', borderRadius: 5, border: `var(--hair-width) solid ${commentsOpen ? UI.goldSoft : UI.hairStrong}`, background: commentsOpen ? UI.goldFaint : 'transparent', color: commentsOpen ? UI.gold : UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
          <span><i className="fa-solid fa-comment" style={{ marginRight: 7 }} /> COMMENTS <span style={{ color: commentsOpen ? UI.goldSoft : UI.inkFaint }}>Â· {detail?.comments?.length || 0}</span></span>
          <i className={`fa-solid fa-chevron-${commentsOpen ? 'up' : 'down'}`} style={{ fontSize: 10 }} />
        </button>
        {commentsOpen && <div>
          {live && <>
          <div className="micro" style={{ color: UI.gold, marginBottom: 8 }}>CHEER THEM ON</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['Let’s go!', 'Strong set!', 'Finish it!'].map(text => <button key={text} onClick={() => send(text, 'cheer')} disabled={sending} style={{ padding: '8px 10px', borderRadius: 5, border: `var(--hair-width) solid ${UI.goldSoft}`, background: UI.goldFaint, color: UI.gold, fontFamily: UI.fontUi, fontSize: 11, cursor: sending ? 'default' : 'pointer' }}>{text}</button>)}
          </div></>}
        <div>
          <div className="micro" style={{ color: UI.gold, marginBottom: 8 }}>COMMENTS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 220, overflowY: 'auto', marginBottom: 8 }}>
            {!detail?.comments?.length && <div className="micro" style={{ color: UI.inkFaint }}>Be the first to say something.</div>}
            {(detail?.comments || []).map(item => <div key={item.id} style={{ padding: '8px 10px', borderRadius: 5, background: item.kind === 'cheer' ? UI.goldFaint : UI.bgInset, border: `var(--hair-width) solid ${item.kind === 'cheer' ? UI.goldSoft : UI.hair}`, color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12 }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}><strong style={{ color: item.kind === 'cheer' ? UI.gold : UI.ink }}>{item.authorName}</strong><span className="micro" style={{ color: UI.inkGhost }}>{socialTime(item.createdAt)}</span></div>
              <div style={{ marginTop: 3 }}>{item.body}</div>
            </div>)}
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            <input value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(comment); } }} maxLength={400} placeholder="Say something" style={{ ...SOCIAL_INPUT_STYLE, flex: 1, padding: '9px 10px' }} />
            <Btn onClick={() => send(comment)} disabled={sending || !comment.trim()} style={{ padding: '9px 11px', minHeight: 0, fontSize: 10 }}>{sending ? '...' : 'Send'}</Btn>
          </div>
        </div>
        </div>}
      </div>
    </Sheet>
  );
}

function FriendsScreen({ store, setStore, userId }) {
  const [activeTab, setActiveTab] = useStateF('circle');
  const [query, setQuery] = useStateF('');
  const [searchResult, setSearchResult] = useStateF(null);
  const [searching, setSearching] = useStateF(false);
  const [loading, setLoading] = useStateF(false);
  const [error, setError] = useStateF('');
  const [selectedChat, setSelectedChat] = useStateF(null);
  const [messageBody, setMessageBody] = useStateF('');
  const [messageFile, setMessageFile] = useStateF(null);
  const [sending, setSending] = useStateF(false);
  const [groupName, setGroupName] = useStateF('');
  const [joinCode, setJoinCode] = useStateF('');
  const [groupBusy, setGroupBusy] = useStateF(false);
  const [copiedGroupId, setCopiedGroupId] = useStateF(null);
  const [planRecipientId, setPlanRecipientId] = useStateF('');
  const [planId, setPlanId] = useStateF(store.activeScheduleId || store.schedules?.[0]?.id || '');
  const [planBusy, setPlanBusy] = useStateF(false);
  const [reportTarget, setReportTarget] = useStateF(null);
  const [reportReason, setReportReason] = useStateF('other');
  const [reportDetails, setReportDetails] = useStateF('');
  const [reportBusy, setReportBusy] = useStateF(false);
  const [selectedWorkout, setSelectedWorkout] = useStateF(null);
  const [expandedGroupMetric, setExpandedGroupMetric] = useStateF(null);

  const data = store.friends;
  const friends = data?.friends || [];
  const groups = data?.groups || [];
  const messages = data?.messages || [];
  const groupMembers = data?.groupMembers || [];
  const incoming = data?.incoming || [];
  const planShares = data?.planShares || [];
  const liveWorkouts = data?.liveWorkouts || [];
  const workoutHistory = data?.workoutHistory || [];

  useEffectF(() => {
    if (!store.settings?.showFriendsTab) return;
    let live = true;
    let retryTimer = null;
    let refreshTimer = null;
    let attempt = 0;
    setLoading(true);
    const load = () => {
      if (!live) return;
      LB.loadFriendsState(userId, LB.socialWeekStartISO()).then(next => {
        if (!live) return;
        setError('');
        setStore(s => s ? { ...s, friends: next } : s);
      }).catch(e => {
        if (!live) return;
        setError(e.message || 'Could not load Friends');
        if (attempt < 2) {
          attempt += 1;
          retryTimer = setTimeout(load, 700 * attempt);
        }
      }).finally(() => { if (live) setLoading(false); });
    };
    load();
    refreshTimer = setInterval(load, 8000);
    return () => {
      live = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (refreshTimer) clearInterval(refreshTimer);
    };
  }, [userId, store.settings?.showFriendsTab]);

  const reload = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await LB.loadFriendsState(userId, LB.socialWeekStartISO());
      setStore(s => s ? { ...s, friends: next } : s);
    } catch (e) {
      setError(e.message || 'Could not load Friends');
    } finally {
      setLoading(false);
    }
  };

  const patchSocial = (patch) => setStore(s => {
    if (!s) return s;
    const current = s.friends || {};
    const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
    return { ...s, friends: next };
  });

  const runAction = async (action, successTab = null) => {
    setError('');
    try {
      await action();
      await reload();
      if (successTab) setActiveTab(successTab);
    } catch (e) {
      setError(e.message || 'Action failed');
    }
  };

  const search = async () => {
    const value = query.trim();
    if (!value || searching) return;
    setSearching(true);
    setSearchResult(null);
    setError('');
    try {
      setSearchResult(await LB.lookupSocialProfile(value));
    } catch (e) {
      setError(e.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const ownMetrics = useMemoF(() => {
    const start = data?.weekStart || LB.socialWeekStartISO();
    const end = new Date(`${start}T12:00:00`);
    end.setDate(end.getDate() + 7);
    const fullEndISO = LB.fmtISO(end);
    const todayISO = LB.todayISO();
    const logs = (store.dailyLogs || []).filter(l => l.date >= start && l.date < fullEndISO);
    const sessions = (store.sessions || []).filter(s => {
      const date = String(s.date || '').slice(0, 10);
      return date >= start && date < fullEndISO && s.ended;
    });
    const adherenceValues = logs.filter(l => l.date < todayISO).map(l => Number(l.adherence)).filter(Number.isFinite);
    return {
      steps: logs.some(l => l.steps != null) ? logs.reduce((sum, l) => sum + (Number(l.steps) || 0), 0) : null,
      workouts: sessions.length ? sessions.length : null,
      adherence: adherenceValues.length ? Math.round((adherenceValues.reduce((a, b) => a + b, 0) / adherenceValues.length) * 10) / 10 : null,
    };
  }, [store.dailyLogs, store.sessions, data?.weekStart, LB.todayISO()]);

  const leaderboard = (metric, groupId = null) => {
    const rows = (groupId
      ? groupMembers.filter(m => m.groupId === groupId).map(m => ({
        userId: m.userId, name: m.userId === userId ? (store.user?.name || 'You') : (m.name || m.handle || 'Group member'),
        value: m.userId === userId ? ownMetrics[metric] : m[metric], own: m.userId === userId,
      }))
      : [
        { userId, name: store.user?.name || 'You', value: ownMetrics[metric], own: true },
        ...friends.map(f => ({ userId: f.userId, name: f.name || f.handle || 'Friend', value: f[metric], own: false })),
      ]).filter(row => row.value != null);
    return rows.sort((a, b) => Number(b.value) - Number(a.value));
  };

  const friendById = id => friends.find(f => f.userId === id) || null;
  const groupById = id => groups.find(g => g.id === id) || null;
  const activeSchedule = (store.schedules || []).find(s => s.id === planId) || store.schedules?.[0] || null;

  const activeChat = selectedChat;
  const activeFriend = activeChat?.type === 'friend' ? friendById(activeChat.id) : null;
  const activeGroup = activeChat?.type === 'group' ? groupById(activeChat.id) : null;
  const chatMessages = activeChat ? messages.filter(m => activeChat.type === 'group'
    ? m.groupId === activeChat.id
    : !m.groupId && ((m.senderId === userId && m.recipientId === activeChat.id) || (m.senderId === activeChat.id && m.recipientId === userId))) : [];

  useEffectF(() => {
    if (activeTab !== 'chats' || !activeChat) return;
    const unread = chatMessages.filter(m => m.senderId !== userId && !(data?.readMessageIds || []).includes(m.id));
    if (!unread.length) return;
    LB.markSocialMessagesRead(userId, unread.map(m => m.id)).then(() => {
      patchSocial(s => ({
        ...s,
        readMessageIds: [...new Set([...(s.readMessageIds || []), ...unread.map(m => m.id)])],
        unreadCount: Math.max(0, (s.unreadCount || 0) - unread.length),
      }));
    }).catch(() => {});
  }, [activeTab, activeChat?.type, activeChat?.id, messages.length]);

  const sendMessage = async () => {
    if (!activeChat || sending || (!messageBody.trim() && !messageFile)) return;
    setSending(true);
    const body = messageBody.trim() || '[image]';
    const file = messageFile;
    setMessageBody('');
    setMessageFile(null);
    try {
      const message = await LB.sendSocialMessage({
        senderId: userId,
        recipientId: activeChat.type === 'friend' ? activeChat.id : null,
        groupId: activeChat.type === 'group' ? activeChat.id : null,
        body,
      });
      patchSocial(s => ({ ...s, messages: [...(s.messages || []), message] }));
      if (file) {
        try {
          const attachment = await LB.uploadSocialAttachment(file, userId, message.id);
          patchSocial(s => ({
            ...s,
            messages: (s.messages || []).map(m => m.id === message.id ? { ...m, attachments: [attachment] } : m),
          }));
        } catch (e) {
          setError(e.message || 'Image upload failed');
        }
      }
    } catch (e) {
      setMessageBody(body === '[image]' ? '' : body);
      setMessageFile(file);
      setError(e.message || 'Message failed to send');
    } finally {
      setSending(false);
    }
  };

  const createGroup = async () => {
    if (!groupName.trim() || groupBusy) return;
    setGroupBusy(true);
    await runAction(async () => { await LB.createSocialGroup(groupName.trim()); setGroupName(''); }, 'groups');
    setGroupBusy(false);
  };

  const joinGroup = async () => {
    if (!joinCode.trim() || groupBusy) return;
    setGroupBusy(true);
    await runAction(async () => { await LB.joinSocialGroup(joinCode.trim()); setJoinCode(''); }, 'groups');
    setGroupBusy(false);
  };

  const leaveGroup = async group => {
    if (!window.confirm(`Leave ${group.name}?`)) return;
    await runAction(() => LB.leaveSocialGroup(group.id), 'groups');
    if (activeChat?.id === group.id) setSelectedChat(null);
  };

  const deleteGroup = async group => {
    if (group.ownerId !== userId || !window.confirm(`Delete ${group.name}? This removes its members and messages.`)) return;
    await runAction(() => LB.deleteSocialGroup(group.id), 'groups');
    if (activeChat?.id === group.id) setSelectedChat(null);
  };

  const copyGroupCode = async group => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(group.joinCode);
      } else {
        const input = document.createElement('textarea');
        input.value = group.joinCode;
        input.setAttribute('readonly', '');
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        if (!document.execCommand('copy')) throw new Error('Copy unavailable');
        input.remove();
      }
      setCopiedGroupId(group.id);
      window.setTimeout(() => setCopiedGroupId(current => current === group.id ? null : current), 1600);
    } catch (e) {
      setError(`Could not copy the code. Enter it manually: ${group.joinCode}`);
    }
  };

  const sendPlan = async () => {
    if (!planRecipientId || !activeSchedule || planBusy) return;
    setPlanBusy(true);
    try {
      // A schedule only stores exercise ids. Include the referenced exercise
      // rows as part of the immutable share, otherwise a receiver gets days
      // whose items point at an exercise library they do not have.
      const schedule = JSON.parse(JSON.stringify(activeSchedule));
      delete schedule.user_id;
      delete schedule.userId;
      delete schedule.id;
      delete schedule.versions;
      const exerciseIds = new Set();
      (schedule.days || []).forEach(day => (day.items || []).forEach(item => {
        if (item.exId) exerciseIds.add(item.exId);
      }));
      const exercises = (store.exercises || []).filter(ex => exerciseIds.has(ex.id));
      const snapshot = { type: 'zane-plan', version: 1, schedule, exercises };
      await LB.createSocialPlanShare(planRecipientId, activeSchedule.name || 'Shared plan', snapshot);
      await reload();
      setPlanRecipientId('');
    } catch (e) {
      setError(e.message || 'Plan could not be shared');
    } finally {
      setPlanBusy(false);
    }
  };

  const importPlan = async share => {
    const source = share.snapshot && typeof share.snapshot === 'object' ? share.snapshot : null;
    if (!source) return;
    const sourceSchedule = source.schedule && typeof source.schedule === 'object' ? source.schedule : source;
    const sourceExercises = Array.isArray(source.exercises) ? source.exercises : [];
    const existingByName = new Map((store.exercises || []).map(ex => [String(ex.name || '').trim().toLowerCase(), ex]));
    const idMap = {};
    const newExercises = [];
    sourceExercises.forEach(ex => {
      if (!ex || !ex.id || !String(ex.name || '').trim()) return;
      const existing = existingByName.get(String(ex.name).trim().toLowerCase());
      if (existing) {
        idMap[ex.id] = existing.id;
        return;
      }
      const id = LB.uid();
      idMap[ex.id] = id;
      newExercises.push({
        id, name: ex.name, tags: ex.tags || [], note: ex.note || '', category: ex.category || null,
        unilateral: ex.unilateral || false, equipment: ex.equipment || null,
        progression_reps: ex.progression_reps || null, movement_type: ex.movement_type || null,
        log_mode: ex.log_mode || null, no_weight_reps: ex.no_weight_reps || false,
        pull_bodyweight: ex.pull_bodyweight || false, bodyweight_mode: ex.bodyweight_mode || null,
        youtube_url: ex.youtube_url || null,
      });
    });
    const imported = {
      ...sourceSchedule,
      id: LB.uid(),
      name: `${share.planName || 'Shared plan'} (shared)`,
      archived: false,
      is_template: false,
    };
    imported.days = (sourceSchedule.days || []).map(day => ({
      ...day,
      id: LB.uid(),
      items: (day.items || []).map(item => ({ ...item, exId: idMap[item.exId] || item.exId })),
    }));
    if (imported.program_data && typeof imported.program_data === 'object') {
      const remapKeys = object => Object.fromEntries(Object.entries(object || {}).map(([key, value]) => [idMap[key] || key, value]));
      if (imported.program_data.mainLifts) imported.program_data.mainLifts = remapKeys(imported.program_data.mainLifts);
      if (imported.program_data.tmHistory) imported.program_data.tmHistory = remapKeys(imported.program_data.tmHistory);
    }
    delete imported.versions;
    delete imported.user_id;
    delete imported.userId;
    setStore(s => s ? {
      ...s,
      exercises: [...(s.exercises || []), ...newExercises],
      schedules: [...(s.schedules || []), imported],
    } : s);
    try {
      await LB.markSocialPlanImported(share.id);
      patchSocial(s => ({ ...s, planShares: (s.planShares || []).map(p => p.id === share.id ? { ...p, importedAt: new Date().toISOString() } : p) }));
    } catch (e) {
      setError(e.message || 'Plan imported locally, but receipt could not be marked');
    }
  };

  const deletePlanShare = async share => {
    const sender = share.senderId === userId;
    const action = sender ? 'Take back' : 'Delete';
    if (!window.confirm(`${action} this shared plan?`)) return;
    await runAction(() => LB.deleteSocialPlanShare(share.id), 'plans');
  };

  const submitReport = async () => {
    if (!reportTarget || reportBusy) return;
    setReportBusy(true);
    try {
      await LB.reportSocial({ targetUserId: reportTarget.userId, reason: reportReason, details: reportDetails });
      setReportTarget(null); setReportDetails(''); setReportReason('other');
    } catch (e) {
      setError(e.message || 'Report failed');
    } finally {
      setReportBusy(false);
    }
  };

  const blockFriend = async friend => {
    if (!window.confirm(`Block ${friend.name || 'this user'}? This also removes the friendship.`)) return;
    await runAction(() => LB.blockSocialUser(friend.userId));
    if (activeChat?.id === friend.userId) setSelectedChat(null);
  };

  if (!data) {
    return (
      <Screen scroll={false}>
        <TopBar title="Friends" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28 }}>
          <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>{loading ? 'Loading Friends...' : error ? 'Friends could not be loaded.' : 'Friends is not ready yet.'}</div>
          {error && <div style={{ maxWidth: 300, color: UI.danger, fontFamily: UI.fontUi, fontSize: 11, lineHeight: 1.4, textAlign: 'center' }}>{error}</div>}
          {!loading && <Btn kind="ghost" onClick={reload}>Retry</Btn>}
        </div>
      </Screen>
    );
  }

  const renderSearch = () => (
    <Card style={{ marginBottom: 12 }}>
      <div className="micro" style={{ color: UI.gold, marginBottom: 10 }}>ADD A FRIEND</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input id="friends-add-input" value={query} onChange={e => { setQuery(e.target.value); setSearchResult(null); }} onKeyDown={e => e.key === 'Enter' && search()} placeholder="Handle or friend code" style={{ ...SOCIAL_INPUT_STYLE, flex: 1 }} />
        <Btn onClick={search} disabled={searching || !query.trim()} style={{ padding: '10px 12px', minHeight: 0, fontSize: 10 }}>{searching ? '...' : 'Find'}</Btn>
      </div>
      {searchResult && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, paddingTop: 12, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>{searchResult.name}</div>
            <div className="micro" style={{ marginTop: 3 }}>{searchResult.handle ? `@${searchResult.handle.replace(/^@/, '')}` : searchResult.friendCode}</div>
          </div>
          {searchResult.relationship === 'none'
            ? <Btn onClick={() => runAction(() => LB.sendSocialFriendRequest(searchResult.userId))} style={{ padding: '9px 12px', minHeight: 0, fontSize: 10 }}>Add</Btn>
            : <span className="micro" style={{ color: UI.gold }}>{searchResult.relationship}</span>}
        </div>
      )}
    </Card>
  );

  const renderRequests = () => incoming.length === 0 ? null : (
    <Card style={{ marginBottom: 12 }}>
      <div className="micro" style={{ color: UI.gold, marginBottom: 8 }}>FRIEND REQUESTS</div>
      {incoming.map((request, i) => (
        <div key={request.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: i ? `var(--hair-width) solid ${UI.hair}` : 'none' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 13 }}>{request.name || 'Zane athlete'}</div>
            <div className="micro" style={{ marginTop: 3 }}>{request.handle ? `@${request.handle.replace(/^@/, '')}` : 'wants to connect'}</div>
          </div>
          <button onClick={() => runAction(() => LB.respondToSocialFriendRequest(request.id, false))} style={{ padding: '7px 10px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent', color: UI.inkFaint, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 10 }}>Decline</button>
          <Btn onClick={() => runAction(() => LB.respondToSocialFriendRequest(request.id, true))} style={{ padding: '7px 10px', minHeight: 0, fontSize: 10 }}>Accept</Btn>
        </div>
      ))}
    </Card>
  );

  const renderFriend = friend => (
    <Card key={friend.userId} style={{ padding: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(var(--accent-rgb),0.15)', border: `var(--hair-width) solid ${UI.hairStrong}`, color: UI.gold, fontFamily: UI.fontUi, fontWeight: 700 }}>{(friend.name || 'Z')[0].toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, fontWeight: 600 }}>{friend.name || 'Zane athlete'}</div>
          <div className="micro" style={{ marginTop: 2 }}>{friend.handle ? `@${friend.handle.replace(/^@/, '')}` : friend.friendCode}</div>
        </div>
        <button onClick={() => { setSelectedChat({ type: 'friend', id: friend.userId }); setActiveTab('chats'); }} style={{ width: 32, height: 32, borderRadius: 5, border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent', color: UI.gold, cursor: 'pointer' }} aria-label="Message friend"><i className="fa-solid fa-comment" /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 12 }}>
        {['steps', 'workouts', 'adherence'].map(metric => (
          <div key={metric} style={{ padding: '8px 5px', background: UI.bgInset, borderRadius: 4, textAlign: 'center' }}>
            <div className="micro" style={{ color: UI.inkFaint }}>{socialMetricLabel(metric)}</div>
            <div style={{ fontFamily: UI.fontNum, fontSize: 11, color: friend[metric] == null ? UI.inkGhost : UI.inkSoft, marginTop: 4 }}>{socialMetricValue(metric, friend[metric]) || 'Not shared'}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
        <button onClick={() => setReportTarget(friend)} style={{ background: 'none', border: 'none', padding: 0, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Report</button>
        <button onClick={() => blockFriend(friend)} style={{ background: 'none', border: 'none', padding: 0, color: UI.danger, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Block</button>
        <button onClick={() => runAction(() => LB.removeSocialFriend(friend.userId))} style={{ marginLeft: 'auto', background: 'none', border: 'none', padding: 0, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Remove</button>
      </div>
    </Card>
  );

  const renderWorkoutCard = workout => (
    <Card key={workout.sessionId} style={{ padding: 13, borderColor: workout.live ? UI.goldSoft : UI.hairStrong }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', background: workout.live ? UI.goldFaint : UI.bgInset, border: `var(--hair-width) solid ${workout.live ? UI.goldSoft : UI.hairStrong}`, color: workout.live ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi, fontWeight: 700 }}>{(workout.ownerName || 'Z')[0].toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
            <span style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>{workout.ownerName}</span>
            {workout.live && <span className="micro" style={{ color: UI.gold }}>LIVE</span>}
          </div>
          <div className="micro" style={{ marginTop: 3, color: UI.inkFaint }}>{workout.dayName || 'Workout'} · {workout.live ? 'now' : socialDate(workout.ended || workout.date)}</div>
        </div>
        <Btn onClick={() => setSelectedWorkout(workout)} style={{ padding: '8px 10px', minHeight: 0, fontSize: 10 }}>{workout.live ? 'Watch' : 'View'}</Btn>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
        <span className="num" style={{ color: UI.inkSoft, fontSize: 11 }}>{workout.setsDone}/{workout.setsTotal || '—'} sets</span>
        <span className="num" style={{ color: UI.inkFaint, fontSize: 11 }}>{workout.exerciseCount} exercises</span>
      </div>
    </Card>
  );

  const renderCircle = () => (
    <>
      <div style={{ position: 'relative', overflow: 'hidden', padding: 18, borderRadius: 8, border: `var(--hair-width) solid ${UI.goldSoft}`, background: 'linear-gradient(135deg, rgba(var(--accent-rgb),0.18), rgba(19,18,25,0.96) 72%)', marginBottom: 16 }}>
        <div style={{ position: 'absolute', width: 190, height: 190, borderRadius: '50%', border: `var(--hair-width) solid rgba(var(--accent-rgb),0.18)`, right: -70, top: -84, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', width: 122, height: 122, borderRadius: '50%', border: `var(--hair-width) solid rgba(var(--accent-rgb),0.18)`, right: -28, top: -50, pointerEvents: 'none' }} />
        <div className="micro" style={{ color: UI.gold, position: 'relative' }}>YOUR CIRCLE</div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 9 }}>
          <div>
            <div className="display" style={{ color: UI.ink, fontSize: 31, lineHeight: 1 }}>FRIENDS</div>
            <div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, lineHeight: 1.45, marginTop: 9, maxWidth: 250 }}>Train together, keep each other moving.</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="num" style={{ color: UI.gold, fontSize: 28, lineHeight: 1 }}>{friends.length}</div>
            <div className="micro" style={{ color: UI.inkFaint, marginTop: 5 }}>{friends.length === 1 ? 'CONNECTION' : 'CONNECTIONS'}</div>
          </div>
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginTop: 17 }}>
          <div style={{ display: 'flex', paddingLeft: 2 }}>
            {friends.slice(0, 6).map((friend, index) => <div key={friend.userId} style={{ width: 30, height: 30, marginLeft: index ? -7 : 0, borderRadius: '50%', display: 'grid', placeItems: 'center', background: index % 2 ? UI.bgRaised : UI.goldFaint, border: `2px solid ${UI.bg}`, color: index % 2 ? UI.inkSoft : UI.gold, fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700 }}>{socialInitials(friend.name)}</div>)}
            {!friends.length && <div className="micro" style={{ color: UI.inkFaint }}>Your circle is waiting.</div>}
          </div>
          {liveWorkouts.length > 0 && <span className="micro" style={{ marginLeft: 'auto', color: UI.gold }}>{liveWorkouts.length} LIVE NOW</span>}
        </div>
        <div style={{ position: 'relative', display: 'flex', gap: 7, marginTop: 17, flexWrap: 'wrap' }}>
          <Btn onClick={() => document.getElementById('friends-add-input')?.focus()} style={{ padding: '9px 12px', minHeight: 0, fontSize: 10 }}>Find people</Btn>
          <button onClick={() => setActiveTab('activity')} style={{ padding: '8px 11px', borderRadius: 5, border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>See activity</button>
        </div>
      </div>
      {renderRequests()}
      <div>{renderSearch()}</div>
      <div className="micro" style={{ color: UI.gold, margin: '17px 0 8px' }}>PEOPLE IN YOUR CIRCLE <span style={{ color: UI.inkFaint }}>· {friends.length}</span></div>
      {friends.length === 0
        ? <Empty title="No friends yet" sub="Search by handle or friend code to start your circle." />
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{friends.map(renderFriend)}</div>}
      <div className="micro" style={{ color: UI.gold, margin: '19px 0 8px' }}>SOCIAL SPACES</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9 }}>
        <button onClick={() => setActiveTab('groups')} style={{ minWidth: 0, textAlign: 'left', padding: 13, borderRadius: 6, border: `var(--hair-width) solid ${UI.hairStrong}`, background: UI.bgRaised, color: UI.ink, cursor: 'pointer' }}>
          <i className="fa-solid fa-users" style={{ color: UI.gold, fontSize: 16 }} />
          <div style={{ fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, marginTop: 10 }}>Groups</div>
          <div className="micro" style={{ marginTop: 4 }}>{groups.length} {groups.length === 1 ? 'space' : 'spaces'}</div>
        </button>
        <button onClick={() => setActiveTab('plans')} style={{ minWidth: 0, textAlign: 'left', padding: 13, borderRadius: 6, border: `var(--hair-width) solid ${UI.hairStrong}`, background: UI.bgRaised, color: UI.ink, cursor: 'pointer' }}>
          <i className="fa-solid fa-share-nodes" style={{ color: UI.gold, fontSize: 16 }} />
          <div style={{ fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, marginTop: 10 }}>Plan swaps</div>
          <div className="micro" style={{ marginTop: 4 }}>{planShares.length} shared</div>
        </button>
      </div>
    </>
  );

  const renderActivity = () => (
    <>
      <div style={{ padding: 17, borderRadius: 8, border: `var(--hair-width) solid ${liveWorkouts.length ? UI.goldSoft : UI.hairStrong}`, background: liveWorkouts.length ? 'linear-gradient(135deg, rgba(var(--accent-rgb),0.16), rgba(19,18,25,0.96) 72%)' : UI.bgRaised, marginBottom: 16 }}>
        <div className="micro" style={{ color: UI.gold }}>CIRCLE ACTIVITY</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 9 }}>
          <div>
            <div className="display" style={{ color: UI.ink, fontSize: 27, lineHeight: 1 }}>IN MOTION</div>
            <div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, lineHeight: 1.45, marginTop: 8 }}>See what your people are doing right now and this week.</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}><div className="num" style={{ color: liveWorkouts.length ? UI.gold : UI.inkFaint, fontSize: 26, lineHeight: 1 }}>{liveWorkouts.length}</div><div className="micro" style={{ color: UI.inkFaint, marginTop: 5 }}>LIVE</div></div>
        </div>
      </div>
      <div className="micro" style={{ color: UI.gold, margin: '8px 0' }}>LIVE NOW</div>
      {liveWorkouts.length > 0
        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{liveWorkouts.map(renderWorkoutCard)}</div>
        : <Card style={{ padding: 15 }}><div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 13 }}>No one is training live right now.</div><div className="micro" style={{ marginTop: 5 }}>Finished workouts stay visible from the day you became friends.</div></Card>}
      <div className="micro" style={{ color: UI.gold, margin: '19px 0 8px' }}>THIS WEEK</div>
      <Card>
        <div style={{ fontSize: 12, color: UI.inkFaint, lineHeight: 1.45, marginBottom: 12 }}>Only metrics explicitly shared by each person appear here. Missing values are never treated as zero.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7 }}>
          {['steps', 'workouts', 'adherence'].map(metric => {
            const top = leaderboard(metric)[0];
            return <div key={metric} style={{ minWidth: 0, padding: '10px 7px', borderRadius: 5, background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}` }}>
              <div className="micro" style={{ color: UI.gold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{socialMetricLabel(metric)}</div>
              <div style={{ color: top ? UI.ink : UI.inkGhost, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, marginTop: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{top?.name || 'No data'}</div>
              <div className="num" style={{ color: top ? UI.inkSoft : UI.inkGhost, fontSize: 10, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{top ? socialMetricValue(metric, top.value) : '-'}</div>
            </div>;
          })}
        </div>
      </Card>
      {workoutHistory.length > 0 && <>
        <div className="micro" style={{ color: UI.gold, margin: '19px 0 8px' }}>RECENT WORKOUTS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{workoutHistory.slice(0, 12).map(renderWorkoutCard)}</div>
      </>}
    </>
  );

  const conversationButton = (item, type, label, count = 0) => (
    <button key={`${type}-${item}`} onClick={() => setSelectedChat({ type, id: item })} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '10px 9px', borderRadius: 5, border: `var(--hair-width) solid ${activeChat?.type === type && activeChat?.id === item ? UI.gold : UI.hairStrong}`, background: activeChat?.type === type && activeChat?.id === item ? 'rgba(var(--accent-rgb),0.12)' : 'transparent', color: UI.ink, cursor: 'pointer', textAlign: 'left' }}>
      <i className={`fa-solid ${type === 'group' ? 'fa-users' : 'fa-user'}`} style={{ width: 16, color: UI.gold, fontSize: 12 }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: UI.fontUi, fontSize: 12 }}>{label}</span>
      {count > 0 && <span style={{ minWidth: 17, height: 17, borderRadius: '50%', display: 'grid', placeItems: 'center', background: UI.gold, color: 'var(--accent-ink)', fontSize: 9, fontWeight: 700 }}>{count}</span>}
    </button>
  );

  const renderChatsRedesigned = () => {
    const conversationList = (
      <>
        <div className="micro" style={{ color: UI.gold, marginBottom: 9 }}>INBOX</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {friends.map(friend => conversationButton(friend.userId, 'friend', friend.name || friend.handle || 'Friend'))}
          {groups.map(group => conversationButton(group.id, 'group', group.name))}
        </div>
        {!friends.length && !groups.length && <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.4 }}>Add a friend or create a group to start a conversation.</div>}
      </>
    );

    if (!activeChat) return (
      <>
        <div style={{ padding: 17, borderRadius: 8, border: `var(--hair-width) solid ${UI.hairStrong}`, background: UI.bgRaised, marginBottom: 14 }}>
          <div className="micro" style={{ color: UI.gold }}>MESSAGES</div>
          <div className="display" style={{ color: UI.ink, fontSize: 27, lineHeight: 1, marginTop: 9 }}>STAY IN TOUCH</div>
          <div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, lineHeight: 1.45, marginTop: 8 }}>Pick a person or group. Your conversation opens full width so the thread stays readable on mobile.</div>
        </div>
        <Card style={{ padding: 14 }}>{conversationList}</Card>
      </>
    );

    return (
      <>
        <button onClick={() => setSelectedChat(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: 0, margin: '0 0 9px', border: 'none', background: 'none', color: UI.gold, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer' }}><i className="fa-solid fa-arrow-left" /> Conversations</button>
        <Card style={{ padding: 0, overflow: 'hidden', background: UI.bgInset }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', borderBottom: `var(--hair-width) solid ${UI.hair}` }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', display: 'grid', placeItems: 'center', background: activeGroup ? UI.goldFaint : 'rgba(var(--accent-rgb),0.15)', border: `var(--hair-width) solid ${UI.goldSoft}`, color: UI.gold, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700 }}>{socialInitials(activeFriend?.name || activeGroup?.name)}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeFriend?.name || activeGroup?.name || 'Conversation'}</div>
              <div className="micro" style={{ marginTop: 3 }}>{activeGroup ? 'GROUP CHAT' : 'DIRECT MESSAGE'}</div>
            </div>
          </div>
          <div style={{ minHeight: 300, maxHeight: '55vh', overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!chatMessages.length && <div className="micro" style={{ margin: 'auto', color: UI.inkFaint }}>Start the conversation.</div>}
            {chatMessages.map(message => {
              const own = message.senderId === userId;
              return <div key={message.id} style={{ alignSelf: own ? 'flex-end' : 'flex-start', maxWidth: '88%', display: 'flex', flexDirection: 'column', alignItems: own ? 'flex-end' : 'flex-start' }}>
                <div style={{ padding: '9px 11px', borderRadius: 7, background: own ? 'rgba(var(--accent-rgb),0.18)' : UI.bgRaised, border: `var(--hair-width) solid ${own ? UI.goldSoft : UI.hairStrong}`, color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, lineHeight: 1.45 }}>
                  {message.body !== '[image]' && message.body}
                  {message.attachments?.map(attachment => attachment.url ? <img key={attachment.id} src={attachment.url} alt={attachment.fileName || 'Attachment'} style={{ display: 'block', maxWidth: 190, maxHeight: 190, borderRadius: 5, marginTop: message.body !== '[image]' ? 6 : 0, objectFit: 'cover' }} /> : <span key={attachment.id}>Image</span>)}
                  {message.body === '[image]' && !message.attachments?.length && <span>Image</span>}
                </div>
                <span className="micro" style={{ color: UI.inkGhost, marginTop: 3 }}>{socialTime(message.createdAt)}</span>
              </div>;
            })}
          </div>
          <div style={{ padding: 9, borderTop: `var(--hair-width) solid ${UI.hair}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {messageFile && <div className="micro" style={{ color: UI.gold }}>Attached: {messageFile.name}</div>}
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={messageBody} onChange={e => setMessageBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="Message" style={{ ...SOCIAL_INPUT_STYLE, flex: 1, padding: '9px 10px' }} />
              <label style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', borderRadius: 5, border: `var(--hair-width) solid ${UI.hairStrong}`, color: UI.inkFaint, cursor: 'pointer', flexShrink: 0 }} aria-label="Attach image"><i className="fa-solid fa-image" /><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => { setMessageFile(e.target.files?.[0] || null); e.target.value = ''; }} style={{ display: 'none' }} /></label>
              <Btn onClick={sendMessage} disabled={sending || (!messageBody.trim() && !messageFile)} style={{ padding: '8px 10px', minHeight: 34, fontSize: 10 }}>{sending ? '...' : 'Send'}</Btn>
            </div>
          </div>
        </Card>
      </>
    );
  };

  const renderGroupsLegacy = () => (
    <>
      <button onClick={() => setActiveTab('circle')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: 0, margin: '0 0 10px', border: 'none', background: 'none', color: UI.gold, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer' }}><i className="fa-solid fa-arrow-left" /> Circle</button>
      <Card style={{ marginBottom: 12 }}>
        <div className="micro" style={{ color: UI.gold, marginBottom: 9 }}>CREATE GROUP</div>
        <div style={{ display: 'flex', gap: 8 }}><input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name" style={{ ...SOCIAL_INPUT_STYLE, flex: 1 }} /><Btn onClick={createGroup} disabled={groupBusy || !groupName.trim()} style={{ padding: '10px 11px', minHeight: 0, fontSize: 10 }}>Create</Btn></div>
        <div className="micro" style={{ color: UI.inkFaint, margin: '12px 0 8px' }}>JOIN WITH CODE</div>
        <div style={{ display: 'flex', gap: 8 }}><input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Group code" style={{ ...SOCIAL_INPUT_STYLE, flex: 1 }} /><Btn onClick={joinGroup} disabled={groupBusy || !joinCode.trim()} style={{ padding: '10px 11px', minHeight: 0, fontSize: 10 }}>Join</Btn></div>
      </Card>
      <div className="micro" style={{ color: UI.gold, margin: '8px 0' }}>YOUR GROUPS</div>
      {groups.length === 0 ? <Empty title="No groups yet" sub="Create a private group or join one with a code." /> : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{groups.map(group => {
        const members = groupMembers.filter(m => m.groupId === group.id);
        return <Card key={group.id} style={{ padding: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ flex: 1 }}><div style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 14, fontWeight: 600 }}>{group.name}</div><div className="micro" style={{ marginTop: 3 }}>{members.length} members · code {group.joinCode}</div></div><button onClick={() => { setSelectedChat({ type: 'group', id: group.id }); setActiveTab('chats'); }} style={{ width: 32, height: 32, borderRadius: 5, border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent', color: UI.gold, cursor: 'pointer' }}><i className="fa-solid fa-comment" /></button></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}><span className="micro" style={{ color: UI.inkFaint }}>GROUP CODE</span><span className="num" style={{ flex: 1, color: UI.inkSoft, fontSize: 11, letterSpacing: '0.08em' }}>{group.joinCode}</span><button onClick={() => copyGroupCode(group)} aria-label={`Copy code for ${group.name}`} style={{ padding: '4px 7px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent', color: UI.gold, fontFamily: UI.fontUi, fontSize: 9, cursor: 'pointer' }}>{copiedGroupId === group.id ? 'Copied' : 'Copy'}</button></div>
            <div style={{ marginTop: 12 }}><div className="micro" style={{ color: UI.inkFaint, marginBottom: 5 }}>WEEKLY LEADERS</div>{['steps', 'workouts', 'adherence'].map(metric => { const rows = leaderboard(metric, group.id); if (!rows.length) return null; const top = rows[0]; return <div key={metric} style={{ display: 'grid', gridTemplateColumns: 'minmax(74px, auto) minmax(0, 1fr) max-content', gap: 8, alignItems: 'center', padding: '4px 0' }}><span className="micro" style={{ whiteSpace: 'nowrap' }}>{socialMetricLabel(metric)}</span><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11 }}>{top.name}</span><span className="num" style={{ whiteSpace: 'nowrap', fontSize: 11, color: UI.gold }}>{socialMetricValue(metric, top.value)}</span></div>; })}</div>
           {group.ownerId === userId ? <button onClick={() => deleteGroup(group)} style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, color: UI.danger, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Delete group</button> : <button onClick={() => leaveGroup(group)} style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, color: UI.danger, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Leave group</button>}
        </Card>;
      })}</div>}
    </>
  );

  const renderGroups = () => {
    const metrics = ['steps', 'workouts', 'adherence'];
    return (
      <>
        <button onClick={() => setActiveTab('circle')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: 0, margin: '0 0 10px', border: 'none', background: 'none', color: UI.gold, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer' }}><i className="fa-solid fa-arrow-left" /> Circle</button>
        <div style={{ position: 'relative', overflow: 'hidden', padding: 18, borderRadius: 8, border: `var(--hair-width) solid ${UI.goldSoft}`, background: 'linear-gradient(135deg, rgba(var(--accent-rgb),0.18), rgba(19,18,25,0.96) 72%)', marginBottom: 16 }}>
          <div style={{ position: 'absolute', width: 150, height: 150, borderRadius: '50%', border: `var(--hair-width) solid rgba(var(--accent-rgb),0.18)`, right: -52, top: -62, pointerEvents: 'none' }} />
          <div className="micro" style={{ color: UI.gold, position: 'relative' }}>GROUP TRAINING</div>
          <div className="display" style={{ color: UI.ink, fontSize: 29, lineHeight: 1, marginTop: 9, position: 'relative' }}>YOUR CREW</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, position: 'relative' }}>
            <span className="num" style={{ color: UI.gold, fontSize: 20 }}>{groups.length}</span>
            <span style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12 }}>{groups.length === 1 ? 'private space' : 'private spaces'} for your people</span>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 9, marginBottom: 18 }}>
          <Card style={{ padding: 13, marginBottom: 0 }}>
            <div className="micro" style={{ color: UI.gold, marginBottom: 9 }}>CREATE GROUP</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}><input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Group name" style={SOCIAL_INPUT_STYLE} /><Btn onClick={createGroup} disabled={groupBusy || !groupName.trim()} style={{ padding: '9px 11px', minHeight: 0, fontSize: 10 }}>Create group</Btn></div>
          </Card>
          <Card style={{ padding: 13, marginBottom: 0 }}>
            <div className="micro" style={{ color: UI.gold, marginBottom: 9 }}>JOIN A GROUP</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}><input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Paste group code" style={SOCIAL_INPUT_STYLE} /><Btn onClick={joinGroup} disabled={groupBusy || !joinCode.trim()} style={{ padding: '9px 11px', minHeight: 0, fontSize: 10 }}>Join group</Btn></div>
          </Card>
        </div>
        <div className="micro" style={{ color: UI.gold, margin: '8px 0' }}>YOUR GROUPS <span style={{ color: UI.inkFaint }}>· {groups.length}</span></div>
        {groups.length === 0 ? <Empty title="No groups yet" sub="Create a private group or join one with a code." /> : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{groups.map(group => {
          const members = groupMembers.filter(m => m.groupId === group.id);
          const selected = expandedGroupMetric?.groupId === group.id ? expandedGroupMetric.metric : null;
          const selectedRows = selected ? leaderboard(selected, group.id) : [];
          return <Card key={group.id} style={{ padding: 15, background: 'linear-gradient(135deg, rgba(var(--accent-rgb),0.09), rgba(0,0,0,0.10))' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div style={{ width: 40, height: 40, borderRadius: 7, display: 'grid', placeItems: 'center', background: UI.goldFaint, border: `var(--hair-width) solid ${UI.goldSoft}`, color: UI.gold, fontSize: 16 }}><i className="fa-solid fa-users" /></div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.name}</div><div className="micro" style={{ marginTop: 4 }}>{members.length} {members.length === 1 ? 'member' : 'members'}</div></div>
              <button onClick={() => { setSelectedChat({ type: 'group', id: group.id }); setActiveTab('chats'); }} aria-label={`Open ${group.name} chat`} style={{ width: 36, height: 36, borderRadius: 6, border: `var(--hair-width) solid ${UI.goldSoft}`, background: UI.goldFaint, color: UI.gold, cursor: 'pointer', flexShrink: 0 }}><i className="fa-solid fa-comment" /></button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13, padding: '8px 9px', borderRadius: 5, background: 'rgba(0,0,0,0.13)', border: `var(--hair-width) solid ${UI.hair}` }}>
              <span className="micro" style={{ color: UI.inkFaint }}>GROUP CODE</span><span className="num" style={{ flex: 1, minWidth: 0, color: UI.inkSoft, fontSize: 11, letterSpacing: '0.08em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group.joinCode}</span><button onClick={() => copyGroupCode(group)} aria-label={`Copy code for ${group.name}`} style={{ padding: '5px 8px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent', color: UI.gold, fontFamily: UI.fontUi, fontSize: 9, cursor: 'pointer', flexShrink: 0 }}>{copiedGroupId === group.id ? 'Copied' : 'Copy'}</button>
            </div>
            <div className="micro" style={{ color: UI.inkFaint, margin: '15px 0 7px' }}>COMPARE THIS WEEK <span style={{ color: UI.inkGhost }}>· TAP A CATEGORY</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 7 }}>
              {metrics.map(metric => {
                const rows = leaderboard(metric, group.id);
                const top = rows[0];
                const active = selected === metric;
                return <button key={metric} onClick={() => setExpandedGroupMetric(active ? null : { groupId: group.id, metric })} disabled={!rows.length} style={{ minWidth: 0, padding: '10px 7px', borderRadius: 5, border: `var(--hair-width) solid ${active ? UI.gold : UI.hairStrong}`, background: active ? UI.goldFaint : UI.bgInset, color: UI.ink, textAlign: 'left', cursor: rows.length ? 'pointer' : 'default', opacity: rows.length ? 1 : 0.62 }}>
                  <div className="micro" style={{ color: active ? UI.gold : UI.inkFaint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{socialMetricLabel(metric)}</div>
                  <div style={{ color: top ? UI.inkSoft : UI.inkGhost, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{top?.name || 'Private'}</div>
                  <div className="num" style={{ color: top ? UI.gold : UI.inkGhost, fontSize: 10, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{top ? socialMetricValue(metric, top.value) : 'No shared data'}</div>
                </button>;
              })}
            </div>
            {selected && <div style={{ marginTop: 10, padding: '10px 11px', borderRadius: 5, border: `var(--hair-width) solid ${UI.goldSoft}`, background: 'rgba(var(--accent-rgb),0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}><div className="micro" style={{ color: UI.gold }}>{socialMetricLabel(selected)} LEADERBOARD</div><button onClick={() => setExpandedGroupMetric(null)} aria-label="Close leaderboard" style={{ border: 'none', background: 'none', color: UI.inkFaint, cursor: 'pointer' }}><i className="fa-solid fa-xmark" /></button></div>
              {!selectedRows.length && <div className="micro" style={{ color: UI.inkFaint, padding: '8px 0' }}>No members have shared this category.</div>}
              {selectedRows.map((row, index) => <div key={row.userId} style={{ display: 'grid', gridTemplateColumns: '22px 28px minmax(0, 1fr) max-content', gap: 8, alignItems: 'center', padding: '7px 0', borderTop: index ? `var(--hair-width) solid ${UI.hair}` : 'none' }}>
                <span className="num" style={{ color: index === 0 ? UI.gold : UI.inkFaint, fontSize: 11 }}>{index + 1}</span>
                <span style={{ width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', background: row.own ? UI.goldFaint : UI.bgInset, border: `var(--hair-width) solid ${row.own ? UI.goldSoft : UI.hairStrong}`, color: row.own ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 8, fontWeight: 700 }}>{socialInitials(row.name)}</span>
                <span style={{ minWidth: 0, color: row.own ? UI.ink : UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}{row.own ? ' · You' : ''}</span>
                <span className="num" style={{ color: index === 0 ? UI.gold : UI.inkSoft, fontSize: 11, whiteSpace: 'nowrap' }}>{socialMetricValue(selected, row.value)}</span>
              </div>)}
            </div>}
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 13, paddingTop: 10, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
              {group.ownerId === userId ? <button onClick={() => deleteGroup(group)} style={{ background: 'none', border: 'none', padding: 0, color: UI.danger, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Delete group</button> : <button onClick={() => leaveGroup(group)} style={{ background: 'none', border: 'none', padding: 0, color: UI.danger, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Leave group</button>}
              <button onClick={() => { setSelectedChat({ type: 'group', id: group.id }); setActiveTab('chats'); }} style={{ marginLeft: 'auto', background: 'none', border: 'none', padding: 0, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Open chat <i className="fa-solid fa-arrow-right" /></button>
            </div>
          </Card>;
        })}</div>}
      </>
    );
  };

  const renderPlans = () => (
    <>
      <button onClick={() => setActiveTab('circle')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: 0, margin: '0 0 10px', border: 'none', background: 'none', color: UI.gold, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer' }}><i className="fa-solid fa-arrow-left" /> Circle</button>
      <Card style={{ marginBottom: 12 }}>
        <div className="micro" style={{ color: UI.gold, marginBottom: 9 }}>SHARE A PLAN SNAPSHOT</div>
        <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.45, marginBottom: 10 }}>Sharing creates an immutable copy. Later edits to your plan do not change the version your friend receives.</div>
        <select value={planId} onChange={e => setPlanId(e.target.value)} style={{ ...SOCIAL_INPUT_STYLE, marginBottom: 8 }}>
          {(store.schedules || []).filter(s => !s.archived).map(schedule => <option key={schedule.id} value={schedule.id}>{schedule.name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 8 }}><select value={planRecipientId} onChange={e => setPlanRecipientId(e.target.value)} style={{ ...SOCIAL_INPUT_STYLE, flex: 1 }}><option value="">Choose a friend</option>{friends.map(friend => <option key={friend.userId} value={friend.userId}>{friend.name || friend.handle || friend.friendCode}</option>)}</select><Btn onClick={sendPlan} disabled={planBusy || !planRecipientId || !activeSchedule} style={{ padding: '10px 11px', minHeight: 0, fontSize: 10 }}>{planBusy ? '...' : 'Share'}</Btn></div>
      </Card>
      <div className="micro" style={{ color: UI.gold, margin: '8px 0' }}>RECEIVED SNAPSHOTS</div>
      {planShares.filter(share => share.recipientId === userId).length === 0 ? <Empty title="No shared plans" sub="Plans your friends send will appear here." /> : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{planShares.filter(share => share.recipientId === userId).map(share => {
        const sender = friendById(share.senderId);
        return <Card key={share.id} style={{ padding: 13 }}><div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><div style={{ flex: 1 }}><div style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600 }}>{share.planName}</div><div className="micro" style={{ marginTop: 3 }}>From {sender?.name || 'Friend'} · {socialDate(share.createdAt)}</div></div>{share.importedAt ? <span className="micro" style={{ color: UI.gold }}>Imported</span> : <Btn onClick={() => importPlan(share)} style={{ padding: '8px 10px', minHeight: 0, fontSize: 10 }}>Import</Btn>}</div></Card>;
      })}</div>}
       {planShares.filter(share => share.senderId === userId).length > 0 && <div className="micro" style={{ color: UI.inkFaint, marginTop: 14 }}>Sent snapshots remain immutable and are shown here for your record.</div>}
       {planShares.length > 0 && <>
         <div className="micro" style={{ color: UI.gold, margin: '18px 0 8px' }}>MANAGE SHARES</div>
         <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{planShares.map(share => {
           const own = share.senderId === userId;
           const person = friendById(own ? share.recipientId : share.senderId);
           return <div key={`manage-${share.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 9px', border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 5 }}><div style={{ flex: 1, minWidth: 0 }}><div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{share.planName}</div><div className="micro" style={{ marginTop: 2 }}>{own ? 'To' : 'From'} {person?.name || 'Friend'} · {socialDate(share.createdAt)}</div></div><button onClick={() => deletePlanShare(share)} style={{ padding: '6px 8px', borderRadius: 4, border: `var(--hair-width) solid ${own ? UI.goldSoft : UI.hairStrong}`, background: own ? UI.goldFaint : 'transparent', color: own ? UI.gold : UI.danger, fontFamily: UI.fontUi, fontSize: 9, cursor: 'pointer' }}>{own ? 'Take back' : 'Delete'}</button></div>;
         })}</div>
       </>}
    </>
  );

  return (
    <Screen scroll>
      <TopBar title="Friends" right={<span className="micro" style={{ color: UI.inkFaint }}>{friends.length} friend{friends.length === 1 ? '' : 's'}</span>} />
      <SubTabBar tabs={[{ id: 'circle', label: 'Circle', icon: 'fa-users' }, { id: 'activity', label: 'Activity', icon: 'fa-bolt' }, { id: 'chats', label: 'Chats', icon: 'fa-comment' }]} active={activeTab} onChange={setActiveTab} style={{ paddingBottom: 8 }} />
      <div style={{ padding: '0 18px 28px' }}>
        {error && <div style={{ margin: '8px 0 12px', padding: '9px 11px', borderRadius: 5, background: 'rgba(var(--danger-rgb),0.10)', border: `var(--hair-width) solid rgba(var(--danger-rgb),0.3)`, color: UI.danger, fontFamily: UI.fontUi, fontSize: 12 }}>{error}</div>}
        {activeTab === 'circle' && renderCircle()}
        {activeTab === 'activity' && renderActivity()}
        {activeTab === 'chats' && renderChatsRedesigned()}
        {activeTab === 'groups' && renderGroups()}
        {activeTab === 'plans' && renderPlans()}
        <button onClick={reload} disabled={loading} style={{ display: 'block', margin: '20px auto 0', background: 'none', border: 'none', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: loading ? 'default' : 'pointer' }}>{loading ? 'Refreshing...' : 'Refresh social data'}</button>
      </div>
      <Sheet open={!!reportTarget} onClose={() => setReportTarget(null)} title="Report user">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 13, lineHeight: 1.5 }}>Report {reportTarget?.name || 'this user'} to the Zane team. Blocking is separate and takes effect immediately.</div>
          <select value={reportReason} onChange={e => setReportReason(e.target.value)} style={SOCIAL_INPUT_STYLE}><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="unsafe">Unsafe content</option><option value="other">Other</option></select>
          <textarea value={reportDetails} onChange={e => setReportDetails(e.target.value)} placeholder="Optional details" maxLength={2000} rows={4} style={{ ...SOCIAL_INPUT_STYLE, resize: 'vertical', userSelect: 'text', WebkitUserSelect: 'text' }} />
          <Btn onClick={submitReport} disabled={reportBusy}>{reportBusy ? 'Sending...' : 'Submit report'}</Btn>
        </div>
      </Sheet>
      {selectedWorkout && <SocialWorkoutSheet workout={selectedWorkout} onClose={() => setSelectedWorkout(null)} />}
    </Screen>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { FriendsScreen });
