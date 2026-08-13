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

function SocialToggle({ on, onToggle, label }) {
  return (
    <button onClick={onToggle} aria-label={label} style={{
      width: 42, height: 24, padding: 2, borderRadius: 999,
      border: `var(--hair-width) solid ${on ? 'var(--accent)' : UI.hairStrong}`,
      background: on ? 'var(--accent)' : UI.bgInset, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: on ? 'flex-end' : 'flex-start',
      transition: 'background 0.15s, border-color 0.15s', flexShrink: 0,
      WebkitTapHighlightColor: 'transparent',
    }}>
      <span style={{ width: 18, height: 18, borderRadius: '50%', background: on ? 'var(--accent-ink)' : UI.inkFaint }} />
    </button>
  );
}

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

function FriendsScreen({ store, setStore, userId }) {
  const [activeTab, setActiveTab] = useStateF('overview');
  const [query, setQuery] = useStateF('');
  const [searchResult, setSearchResult] = useStateF(null);
  const [searching, setSearching] = useStateF(false);
  const [profileDraft, setProfileDraft] = useStateF(null);
  const [profileSaving, setProfileSaving] = useStateF(false);
  const [loading, setLoading] = useStateF(false);
  const [error, setError] = useStateF('');
  const [selectedChat, setSelectedChat] = useStateF(null);
  const [messageBody, setMessageBody] = useStateF('');
  const [messageFile, setMessageFile] = useStateF(null);
  const [sending, setSending] = useStateF(false);
  const [groupName, setGroupName] = useStateF('');
  const [joinCode, setJoinCode] = useStateF('');
  const [groupBusy, setGroupBusy] = useStateF(false);
  const [planRecipientId, setPlanRecipientId] = useStateF('');
  const [planId, setPlanId] = useStateF(store.activeScheduleId || store.schedules?.[0]?.id || '');
  const [planBusy, setPlanBusy] = useStateF(false);
  const [reportTarget, setReportTarget] = useStateF(null);
  const [reportReason, setReportReason] = useStateF('other');
  const [reportDetails, setReportDetails] = useStateF('');
  const [reportBusy, setReportBusy] = useStateF(false);

  const data = store.friends;
  const friends = data?.friends || [];
  const groups = data?.groups || [];
  const messages = data?.messages || [];
  const groupMembers = data?.groupMembers || [];
  const incoming = data?.incoming || [];
  const planShares = data?.planShares || [];

  useEffectF(() => {
    const profile = data?.profile;
    if (!profile) return;
    setProfileDraft(profile);
  }, [data?.profile?.handle, data?.profile?.friendCode, data?.profile?.stepsVisible, data?.profile?.workoutsVisible, data?.profile?.adherenceVisible]);

  useEffectF(() => {
    if (!store.settings?.showFriendsTab || store.friends) return;
    let live = true;
    setLoading(true);
    LB.loadFriendsState(userId, LB.socialWeekStartISO()).then(next => {
      if (live) setStore(s => s ? { ...s, friends: next } : s);
    }).catch(e => { if (live) setError(e.message || 'Could not load Friends'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
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

  const saveProfile = async (next) => {
    if (profileSaving) return;
    setProfileSaving(true);
    setError('');
    try {
      const profile = await LB.updateSocialProfile(userId, next);
      patchSocial(s => ({ ...s, profile }));
      setProfileDraft(profile);
    } catch (e) {
      setError(e.message || 'Profile could not be saved');
    } finally {
      setProfileSaving(false);
    }
  };

  const ownMetrics = useMemoF(() => {
    const start = data?.weekStart || LB.socialWeekStartISO();
    const end = new Date(`${start}T12:00:00`);
    end.setDate(end.getDate() + 7);
    const endISO = LB.fmtISO(end);
    const logs = (store.dailyLogs || []).filter(l => l.date >= start && l.date < endISO);
    const sessions = (store.sessions || []).filter(s => {
      const date = String(s.date || '').slice(0, 10);
      return date >= start && date < endISO && s.ended;
    });
    const adherenceValues = logs.map(l => Number(l.adherence)).filter(Number.isFinite);
    return {
      steps: logs.some(l => l.steps != null) ? logs.reduce((sum, l) => sum + (Number(l.steps) || 0), 0) : null,
      workouts: sessions.length ? sessions.length : null,
      adherence: adherenceValues.length ? Math.round((adherenceValues.reduce((a, b) => a + b, 0) / adherenceValues.length) * 10) / 10 : null,
    };
  }, [store.dailyLogs, store.sessions, data?.weekStart]);

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

  const activeChat = selectedChat || (friends[0] ? { type: 'friend', id: friends[0].userId } : groups[0] ? { type: 'group', id: groups[0].id } : null);
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

  const sendPlan = async () => {
    if (!planRecipientId || !activeSchedule || planBusy) return;
    setPlanBusy(true);
    try {
      const snapshot = JSON.parse(JSON.stringify(activeSchedule));
      delete snapshot.user_id;
      delete snapshot.userId;
      snapshot.id = undefined;
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
    const imported = {
      ...source,
      id: LB.uid(),
      name: `${share.planName || 'Shared plan'} (shared)`,
      archived: false,
      is_template: false,
      isTemplate: false,
    };
    delete imported.user_id;
    delete imported.userId;
    setStore(s => s ? { ...s, schedules: [...(s.schedules || []), imported] } : s);
    try {
      await LB.markSocialPlanImported(share.id);
      patchSocial(s => ({ ...s, planShares: (s.planShares || []).map(p => p.id === share.id ? { ...p, importedAt: new Date().toISOString() } : p) }));
    } catch (e) {
      setError(e.message || 'Plan imported locally, but receipt could not be marked');
    }
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
          <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13 }}>{loading ? 'Loading Friends...' : 'Friends is not ready yet.'}</div>
          {!loading && <Btn kind="ghost" onClick={reload}>Retry</Btn>}
        </div>
      </Screen>
    );
  }

  const profile = profileDraft || data.profile || { handle: '', friendCode: '', stepsVisible: false, workoutsVisible: false, adherenceVisible: false };
  const profileNext = patch => ({ ...profile, ...patch });

  const renderProfile = () => (
    <Card style={{ marginBottom: 12 }}>
      <div className="micro" style={{ color: UI.gold, marginBottom: 10 }}>YOUR SOCIAL PROFILE</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={profile.handle || ''}
          onChange={e => setProfileDraft(p => ({ ...(p || profile), handle: e.target.value }))}
          placeholder="@zane_handle"
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          style={{ ...SOCIAL_INPUT_STYLE, flex: 1 }}
        />
        <Btn onClick={() => saveProfile(profile)} disabled={profileSaving} style={{ padding: '10px 12px', minHeight: 0, fontSize: 10 }}>
          {profileSaving ? 'Saving' : 'Save'}
        </Btn>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <span className="micro" style={{ color: UI.inkFaint }}>FRIEND CODE</span>
        <span className="num" style={{ color: UI.ink, letterSpacing: '0.12em' }}>{profile.friendCode || '...'}</span>
        <button onClick={() => navigator.clipboard?.writeText(profile.friendCode || '')} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: UI.gold, cursor: 'pointer', fontSize: 11 }}>Copy</button>
      </div>
      <div style={{ fontSize: 11, color: UI.inkFaint, lineHeight: 1.5, marginTop: 10 }}>
        Use your handle or code to add friends. Metric sharing is opt-in per category.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
        {[
          ['stepsVisible', 'Share weekly steps'],
          ['workoutsVisible', 'Share completed workouts'],
          ['adherenceVisible', 'Share weekly adherence'],
        ].map(([key, label]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span style={{ fontFamily: UI.fontUi, fontSize: 12, color: UI.inkSoft }}>{label}</span>
            <SocialToggle on={!!profile[key]} label={label} onToggle={() => {
              const next = profileNext({ [key]: !profile[key] });
              setProfileDraft(next);
              saveProfile(next);
            }} />
          </div>
        ))}
      </div>
    </Card>
  );

  const renderSearch = () => (
    <Card style={{ marginBottom: 12 }}>
      <div className="micro" style={{ color: UI.gold, marginBottom: 10 }}>ADD A FRIEND</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={query} onChange={e => { setQuery(e.target.value); setSearchResult(null); }} onKeyDown={e => e.key === 'Enter' && search()} placeholder="Handle or friend code" style={{ ...SOCIAL_INPUT_STYLE, flex: 1 }} />
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

  const renderOverview = () => (
    <>
      {renderProfile()}
      {renderSearch()}
      {renderRequests()}
      <div className="micro" style={{ color: UI.gold, margin: '8px 0' }}>FRIENDS</div>
      {friends.length === 0
        ? <Empty title="No friends yet" sub="Search by handle or friend code to start your circle." />
        : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{friends.map(renderFriend)}</div>}
      <div className="micro" style={{ color: UI.gold, margin: '18px 0 8px' }}>THIS WEEK</div>
      <Card>
        <div style={{ fontSize: 12, color: UI.inkFaint, lineHeight: 1.45, marginBottom: 10 }}>Only metrics explicitly shared by each person appear here. Missing values are never treated as zero.</div>
        {['steps', 'workouts', 'adherence'].map(metric => {
          const rows = leaderboard(metric);
          if (!rows.length) return null;
          return <div key={metric} style={{ marginTop: 10 }}>
            <div className="micro" style={{ color: UI.inkSoft, marginBottom: 5 }}>{socialMetricLabel(metric)}</div>
            {rows.slice(0, 5).map((row, i) => <div key={row.userId} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', borderTop: i ? `var(--hair-width) solid ${UI.hair}` : 'none' }}><span className="num" style={{ width: 18, color: i === 0 ? UI.gold : UI.inkFaint }}>{i + 1}</span><span style={{ flex: 1, fontFamily: UI.fontUi, fontSize: 12, color: row.own ? UI.ink : UI.inkSoft }}>{row.name}</span><span className="num" style={{ color: UI.inkSoft, fontSize: 11 }}>{socialMetricValue(metric, row.value)}</span></div>)}
          </div>;
        })}
      </Card>
    </>
  );

  const conversationButton = (item, type, label, count = 0) => (
    <button key={`${type}-${item}`} onClick={() => setSelectedChat({ type, id: item })} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, padding: '10px 9px', borderRadius: 5, border: `var(--hair-width) solid ${activeChat?.type === type && activeChat?.id === item ? UI.gold : UI.hairStrong}`, background: activeChat?.type === type && activeChat?.id === item ? 'rgba(var(--accent-rgb),0.12)' : 'transparent', color: UI.ink, cursor: 'pointer', textAlign: 'left' }}>
      <i className={`fa-solid ${type === 'group' ? 'fa-users' : 'fa-user'}`} style={{ width: 16, color: UI.gold, fontSize: 12 }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: UI.fontUi, fontSize: 12 }}>{label}</span>
      {count > 0 && <span style={{ minWidth: 17, height: 17, borderRadius: '50%', display: 'grid', placeItems: 'center', background: UI.gold, color: 'var(--accent-ink)', fontSize: 9, fontWeight: 700 }}>{count}</span>}
    </button>
  );

  const renderChats = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 10, minHeight: 300 }}>
        <div style={{ width: '36%', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="micro" style={{ color: UI.gold }}>CONVERSATIONS</div>
          {friends.map(f => conversationButton(f.userId, 'friend', f.name || f.handle || 'Friend'))}
          {groups.map(g => conversationButton(g.id, 'group', g.name))}
          {!friends.length && !groups.length && <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.4 }}>Add a friend or create a group to chat.</div>}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, background: UI.bgInset, overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: `var(--hair-width) solid ${UI.hair}`, fontFamily: UI.fontUi, fontSize: 12, color: UI.ink }}>{activeFriend?.name || activeGroup?.name || 'Select a conversation'}</div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {!activeChat && <div className="micro" style={{ margin: 'auto', color: UI.inkFaint }}>No conversation selected.</div>}
            {activeChat && !chatMessages.length && <div className="micro" style={{ margin: 'auto', color: UI.inkFaint }}>Start the conversation.</div>}
            {chatMessages.map(message => {
              const own = message.senderId === userId;
              return <div key={message.id} style={{ alignSelf: own ? 'flex-end' : 'flex-start', maxWidth: '86%', display: 'flex', flexDirection: 'column', alignItems: own ? 'flex-end' : 'flex-start' }}>
                <div style={{ padding: '8px 10px', borderRadius: 6, background: own ? 'rgba(var(--accent-rgb),0.18)' : UI.bgRaised, border: `var(--hair-width) solid ${own ? UI.goldSoft : UI.hairStrong}`, color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 12, lineHeight: 1.4 }}>
                  {message.body !== '[image]' && message.body}
                  {message.attachments?.map(a => a.url ? <img key={a.id} src={a.url} alt={a.fileName || 'Attachment'} style={{ display: 'block', maxWidth: 150, maxHeight: 150, borderRadius: 4, marginTop: message.body !== '[image]' ? 6 : 0, objectFit: 'cover' }} /> : <span key={a.id}>Image</span>)}
                  {message.body === '[image]' && !message.attachments?.length && <span>Image</span>}
                </div>
                <span className="micro" style={{ color: UI.inkGhost, marginTop: 2 }}>{socialTime(message.createdAt)}</span>
              </div>;
            })}
          </div>
          {activeChat && <div style={{ padding: 8, borderTop: `var(--hair-width) solid ${UI.hair}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {messageFile && <div className="micro" style={{ color: UI.gold }}>Attached: {messageFile.name}</div>}
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={messageBody} onChange={e => setMessageBody(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="Message" style={{ ...SOCIAL_INPUT_STYLE, flex: 1, padding: '8px 9px' }} />
              <label style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, color: UI.inkFaint, cursor: 'pointer' }} aria-label="Attach image"><i className="fa-solid fa-image" /><input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={e => { setMessageFile(e.target.files?.[0] || null); e.target.value = ''; }} style={{ display: 'none' }} /></label>
              <Btn onClick={sendMessage} disabled={sending || (!messageBody.trim() && !messageFile)} style={{ padding: '8px 10px', minHeight: 32, fontSize: 10 }}>{sending ? '...' : 'Send'}</Btn>
            </div>
          </div>}
        </div>
      </div>
    </div>
  );

  const renderGroups = () => (
    <>
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
          <div style={{ marginTop: 12 }}><div className="micro" style={{ color: UI.inkFaint, marginBottom: 5 }}>WEEKLY LEADERS</div>{['steps', 'workouts', 'adherence'].map(metric => { const rows = leaderboard(metric, group.id); if (!rows.length) return null; const top = rows[0]; return <div key={metric} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0' }}><span className="micro" style={{ width: 58 }}>{socialMetricLabel(metric)}</span><span style={{ flex: 1, color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11 }}>{top.name}</span><span className="num" style={{ fontSize: 11, color: UI.gold }}>{socialMetricValue(metric, top.value)}</span></div>; })}</div>
          <button onClick={() => leaveGroup(group)} style={{ marginTop: 10, background: 'none', border: 'none', padding: 0, color: group.ownerId === userId ? UI.inkGhost : UI.danger, fontFamily: UI.fontUi, fontSize: 10, cursor: group.ownerId === userId ? 'default' : 'pointer' }} disabled={group.ownerId === userId}>{group.ownerId === userId ? 'Owner' : 'Leave group'}</button>
        </Card>;
      })}</div>}
    </>
  );

  const renderPlans = () => (
    <>
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
    </>
  );

  return (
    <Screen scroll>
      <TopBar title="Friends" right={<span className="micro" style={{ color: UI.inkFaint }}>{friends.length} friend{friends.length === 1 ? '' : 's'}</span>} />
      <SubTabBar tabs={[{ id: 'overview', label: 'Overview', icon: 'fa-compass' }, { id: 'chats', label: 'Chats', icon: 'fa-comment' }, { id: 'groups', label: 'Groups', icon: 'fa-users' }, { id: 'plans', label: 'Plans', icon: 'fa-share-nodes' }]} active={activeTab} onChange={setActiveTab} style={{ paddingBottom: 8 }} />
      <div style={{ padding: '0 18px 28px' }}>
        {error && <div style={{ margin: '8px 0 12px', padding: '9px 11px', borderRadius: 5, background: 'rgba(var(--danger-rgb),0.10)', border: `var(--hair-width) solid rgba(var(--danger-rgb),0.3)`, color: UI.danger, fontFamily: UI.fontUi, fontSize: 12 }}>{error}</div>}
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'chats' && renderChats()}
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
    </Screen>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { FriendsScreen });
