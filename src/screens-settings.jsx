/* Settings screen, appearance, training, data, account, admin */

const { useState: useStateSet, useEffect: useEffectSet, useRef: useRefSet } = React;

// ─── Shared helpers ────────────────────────────────────────────────────

const fmtSec = s => s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Short "time since" label for the admin sign-up feed.
const fmtAgo = (iso) => LB.timeAgo(iso, { capDays: 7 });

// Same noon-anchored day-shift screens-health.jsx's healthShiftISO uses (avoids

// Health-tab card visibility toggles: id must match screens-health.jsx's
// DEFAULT_CARD_ORDER / DEFAULT_COACH_ORDER card ids.
const HEALTH_CARD_TOGGLES = [
  { id: 'week', label: 'Week overview' },
  { id: 'today', label: 'Today' },
  { id: 'aiSummary', label: 'AI Summary' },
  { id: 'macroGroup', label: 'Macros' },
  { id: 'weight', label: 'Weight' },
  { id: 'cardio', label: 'Cardio' },
  { id: 'steps', label: 'Steps' },
  { id: 'water', label: 'Water' },
  { id: 'glucose', label: 'Glucose' },
  { id: 'bloodPressure', label: 'Blood pressure' },
  { id: 'bodyTemp', label: 'Body temperature' },
  { id: 'bodyMeasurements', label: 'Body measurements' },
];

// Boxed input look shared by the settings sheets' plain text/password/email/
// select inputs (password/email change, OTP, admin tools, ...). Spread and
// override for a sheet's specific padding/fontSize/etc.
const SETTINGS_INPUT_STYLE = {
  background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4,
  padding: '10px 14px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink,
  outline: 'none', width: '100%', boxSizing: 'border-box',
};
// Same look, larger radius, for the multi-line support-ticket textareas.
const SETTINGS_TEXTAREA_STYLE = {
  width: '100%', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`,
  borderRadius: 6, padding: '10px 12px', color: UI.ink, fontFamily: UI.fontUi,
  fontSize: 14, outline: 'none', resize: 'none', boxSizing: 'border-box', lineHeight: 1.5,
};

// Admin support-inbox ticket row, active and archived are the same shape,
// the archived variant just mutes it (dimmed colors/opacity, smaller text,
// no unread dot / "no messages yet" placeholder / timestamp).
function AdminTicketRow({ t, archived = false, catLabel, onClick }) {
  const statusColor = { open: UI.danger, in_progress: UI.gold, resolved: UI.inkFaint };
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        background: archived ? UI.bgInset : UI.bgRaised,
        border: `var(--hair-width) solid ${UI.hair}`,
        borderLeft: `3px solid ${archived ? UI.inkGhost : (statusColor[t.support_status] || UI.hairStrong)}`,
        borderRadius: 8, cursor: 'pointer', textAlign: 'left', padding: '12px 14px', marginBottom: 8,
        WebkitTapHighlightColor: 'transparent', display: 'flex', flexDirection: 'column',
        gap: archived ? 4 : 5, opacity: archived ? 0.7 : 1, textShadow: 'none',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: archived ? 13 : 14, fontWeight: 600, color: archived ? UI.inkSoft : UI.ink, fontFamily: UI.fontUi, flex: 1 }}>{t.client_name || t.client_email}</span>
        {!archived && Number(t.unread_count) > 0 && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', flexShrink: 0, animation: 'pulseDot 1.5s ease-in-out infinite' }} />}
        <span className="micro" style={{ color: archived ? UI.inkGhost : (statusColor[t.support_status] || UI.inkFaint) }}>{(t.support_status || (archived ? 'resolved' : 'open')).replace('_', ' ').toUpperCase()}</span>
        {t.support_category && <span className="micro" style={{ color: archived ? UI.inkGhost : UI.inkFaint }}>{catLabel}</span>}
      </div>
      {t.x_handle && <div className="micro" style={{ color: archived ? UI.inkGhost : UI.inkFaint }}>{t.x_handle}</div>}
      {t.last_message_body ? (
        <div style={{ fontSize: archived ? 11 : 12, color: archived ? UI.inkGhost : UI.inkSoft, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.last_message_body}</div>
      ) : (
        !archived && <div style={{ fontSize: 12, color: UI.inkGhost, fontFamily: UI.fontUi, fontStyle: 'italic' }}>No messages yet</div>
      )}
      {!archived && t.last_message_at && (
        <div className="micro" style={{ color: UI.inkGhost }}>{new Date(t.last_message_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} · {new Date(t.last_message_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
      )}
    </button>
  );
}

function UserArchivedSection({ tickets, renderTicket }) {
  const [open, setOpen] = useStateSet(false);
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent' }}>
        <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'}`} style={{ fontSize: 9 }} />
        Archived ({tickets.length})
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>{tickets.map(renderTicket)}</div>}
    </div>
  );
}

// Alpha bumped from the original 0.10/0.22, plenty visible against a vivid
// accent color, but on paper's muted grey accent those read as barely-there
// against bg-raised. Higher alpha keeps a normal accent legible too.
const accentBtn = { background: 'rgba(var(--accent-rgb),0.16)', border: '1px solid rgba(var(--accent-rgb),0.4)', color: 'var(--accent)', padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent', flexShrink: 0 };

const isIosDevice = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

// Every settings sheet renders its title in the accent color.
function SettingsSheet(props) {
  return <Sheet titleColor="var(--accent)" {...props} />;
}

function SocialMetricSharingSheet({ open, onClose, profile, catalog, message, saving, onToggleMetric }) {
  const groups = [...new Set(catalog.map(metric => metric.group))];
  const [openGroups, setOpenGroups] = useStateSet({ Activity: true });

  const toggleGroup = group => setOpenGroups(current => ({ ...current, [group]: !current[group] }));
  const sharedCount = catalog.filter(metric => !!profile?.metricVisibility?.[metric.key]).length;

  return (
    <SettingsSheet open={open} onClose={onClose} title="Metric sharing">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5, marginBottom: 16 }}>
          Choose which health values your friends can see. Shared values are summaries or the latest reading, never notes or exact reading times. Workouts also share live and finished set progress, including weight and reps.
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <div className="micro" style={{ color: UI.gold }}>SHARED METRICS</div>
          <div className="micro" style={{ color: UI.inkFaint }}>{sharedCount} of {catalog.length} enabled</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groups.map(group => {
            const metrics = catalog.filter(metric => metric.group === group);
            const groupSharedCount = metrics.filter(metric => !!profile?.metricVisibility?.[metric.key]).length;
            const expanded = !!openGroups[group];
            return (
              <div key={group} style={{ border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, background: UI.bgInset, overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  aria-expanded={expanded}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '13px 14px', background: 'none', border: 'none', color: UI.ink, cursor: 'pointer', textAlign: 'left', WebkitTapHighlightColor: 'transparent' }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span className="micro" style={{ color: UI.gold, fontWeight: 700 }}>{group.toUpperCase()}</span>
                    <span style={{ display: 'block', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, marginTop: 3 }}>{groupSharedCount} of {metrics.length} enabled</span>
                  </span>
                  <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'}`} aria-hidden="true" style={{ color: UI.inkFaint, fontSize: 11, flexShrink: 0 }} />
                </button>
                {expanded && (
                  <div style={{ padding: '0 14px 8px' }}>
                    <div style={{ borderTop: `var(--hair-width) solid ${UI.hair}` }} />
                    {metrics.map(metric => {
                      const visible = !!profile?.metricVisibility?.[metric.key];
                      return (
                        <div key={metric.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderBottom: `var(--hair-width) solid ${UI.hair}` }}>
                          <div style={{ minWidth: 0 }}>
                            <span style={{ fontFamily: UI.fontUi, fontSize: 12, color: UI.inkSoft }}>{metric.label}</span>
                            {metric.sensitive && <span className="micro" style={{ color: UI.inkFaint, marginLeft: 6 }}>SENSITIVE</span>}
                          </div>
                          <Toggle on={visible} label={metric.label} disabled={saving} onToggle={() => onToggleMetric(metric)} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {message && <div style={{ marginTop: 12, color: message.ok ? UI.ok : UI.danger, fontFamily: UI.fontUi, fontSize: 11 }}>{message.text}</div>}
        <div style={{ marginTop: 24 }}>
          <Btn style={{ width: '100%' }} onClick={onClose}>Done</Btn>
        </div>
      </div>
    </SettingsSheet>
  );
}

function FullSheet({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: UI.bg, backgroundImage: 'var(--bg-texture)', display: 'flex', flexDirection: 'column', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', borderBottom: `var(--hair-width) solid ${UI.hair}`, flexShrink: 0, background: UI.bgRaised }}>
        <div style={{ flex: 1, fontFamily: UI.fontDisplay, fontSize: 22, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--accent)' }}>{title}</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8, color: UI.inkFaint, WebkitTapHighlightColor: 'transparent', display: 'flex', alignItems: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', boxSizing: 'border-box', maxWidth: 540, width: '100%', alignSelf: 'center' }}>
        {children}
      </div>
    </div>
  );
}

// ─── HOW TO SHEET ────────────────────────────────────────────────────
function HowToSheet({ open, onClose }) {
  const [osPickerOpen, setOsPickerOpen] = useStateSet(false);
  const handleClose = () => { onClose(); setOsPickerOpen(false); };
  const btnStyle = {
    width: '100%', background: 'none', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '14px 0', WebkitTapHighlightColor: 'transparent',
  };
  const chevron = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={UI.inkFaint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>;
  return (
    <>
      <SettingsSheet open={open} onClose={handleClose} title="How to…">
        <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
          <button onClick={() => { onClose(); window.__startTour?.('createPlan'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Create a plan &amp; exercise</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Guided tour of plan creation and the training loop</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { onClose(); window.__startTour?.('doWorkout'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Do a workout</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Logging sets, keyboard, plate calc, navigation and ending a session</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { onClose(); window.__startTour?.('quickActions'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Use Quick Actions</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Swipe down on Home for fast-access logging shortcuts</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { onClose(); window.__startTour?.('healthTab'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Use the Health tab</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Daily logging, macro targets, cardio tracking, and week overview</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { onClose(); window.__startTour?.('cardioPlans'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Build a cardio plan</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Manual weekly targets, or a progressive plan toward a goal</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { onClose(); window.__startTour?.('statusModes'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Deload, sick &amp; vacation</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Take it easier without losing progress or skewing your stats</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { onClose(); window.__startTour?.('customize'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Customize the app</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Appearance, rest timers, equipment, progression &amp; tempo</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { onClose(); window.__startTour?.('coaching'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Be a coach / client</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Invites, weekly check-ins, macros and notes, coach and client side</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => setOsPickerOpen(true)} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Install as app</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Add Zane to your home screen, works on iPhone and Android</div>
            </div>
            {chevron}
          </button>
        </div>
      </SettingsSheet>
      <SettingsSheet open={osPickerOpen && open} onClose={() => setOsPickerOpen(false)} title="Install as app">
        <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
          <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5, padding: '4px 0 12px' }}>
            Which device are you installing on?
          </div>
          <button onClick={() => { setOsPickerOpen(false); onClose(); window.__startTour?.('installPwaIos'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>iPhone / iPad</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Safari → Share button → Add to Home Screen</div>
            </div>
            {chevron}
          </button>
          <div className="knurl" />
          <button onClick={() => { setOsPickerOpen(false); onClose(); window.__startTour?.('installPwaAndroid'); }} style={btnStyle}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi }}>Android</div>
              <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>Chrome → three-dot menu → Add to Home screen</div>
            </div>
            {chevron}
          </button>
        </div>
      </SettingsSheet>
    </>
  );
}

// ─── CHANGELOG SHEET ─────────────────────────────────────────────────

// ISO 8601 week number + week-numbering year for a 'YYYY-MM-DD' string.
function changelogIsoWeek(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return { year: 0, week: 0 };
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7) + 3); // Thursday decides the year
  const isoYear = dt.getUTCFullYear();
  const firstThu = new Date(Date.UTC(isoYear, 0, 4));              // Jan 4 always sits in week 1
  firstThu.setUTCDate(firstThu.getUTCDate() - ((firstThu.getUTCDay() + 6) % 7) + 3);
  return { year: isoYear, week: 1 + Math.round((dt - firstThu) / (7 * 86400000)) };
}

// Monday-Sunday span of the week containing dateStr, e.g. "16-22 Jun" (or
// "29 Jun - 5 Jul" across a month boundary).
function changelogWeekRange(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  const mon = new Date(dt); mon.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return mon.getUTCMonth() === sun.getUTCMonth()
    ? `${mon.getUTCDate()}-${sun.getUTCDate()} ${MON[mon.getUTCMonth()]}`
    : `${mon.getUTCDate()} ${MON[mon.getUTCMonth()]} - ${sun.getUTCDate()} ${MON[sun.getUTCMonth()]}`;
}

function ChangelogSheet({ open, onClose }) {
  const [selected, setSelected] = useStateSet(null);         // one entry -> its message
  const [selectedWeek, setSelectedWeek] = useStateSet(null); // week group -> its titles
  const [selectedYear, setSelectedYear] = useStateSet(null); // older year -> its weeks
  const handleClose = () => { onClose(); setSelected(null); setSelectedWeek(null); setSelectedYear(null); };

  // whatsnew.js is a lazy load (index.html's __ensureWhatsNew), so this screen
  // cannot assume window.WHATS_NEW is populated: app.jsx's own What's New effect
  // may not have run yet, may still be in flight, or may have skipped the fetch
  // entirely (it defers to onboarding). Fetch it here rather than rendering a
  // silently empty changelog. __ensureWhatsNew no longer memoizes a rejection,
  // so bumping `attempt` genuinely retries with a fresh script tag.
  const [wnState, setWnState] = useStateSet(window.WHATS_NEW ? 'ready' : 'loading');
  const [attempt, setAttempt] = useStateSet(0);
  React.useEffect(() => {
    if (!open) return;
    if (window.WHATS_NEW) { setWnState('ready'); return; }
    let live = true;
    setWnState('loading');
    window.__ensureWhatsNew()
      .then(() => { if (live) setWnState(window.WHATS_NEW ? 'ready' : 'error'); })
      .catch(() => { if (live) setWnState('error'); });
    return () => { live = false; };
  }, [open, attempt]);
  const retryWhatsNew = () => setAttempt(a => a + 1);

  // Newest 5 shown directly; the rest grouped by ISO week. Weeks of the newest
  // year stay on the top level; older years collapse into a year group, so the
  // list stays short no matter how many releases pile up.
  const { latest, currentWeeks, olderYears } = React.useMemo(() => {
    const all = window.WHATS_NEW || [];
    const latest = all.slice(0, 5);
    const newestYear = all.length ? changelogIsoWeek(all[0].date).year : 0;
    const weekMap = new Map();
    for (const e of all.slice(5)) {
      const { year, week } = changelogIsoWeek(e.date);
      const key = year + '-' + String(week).padStart(2, '0');
      if (!weekMap.has(key)) weekMap.set(key, { key, year, week, date: e.date, entries: [] });
      weekMap.get(key).entries.push(e);
    }
    const weeks = [...weekMap.values()]; // insertion order == newest-first
    const yearMap = new Map();
    for (const w of weeks.filter(w => w.year !== newestYear)) {
      if (!yearMap.has(w.year)) yearMap.set(w.year, { year: w.year, weeks: [], count: 0 });
      const g = yearMap.get(w.year); g.weeks.push(w); g.count += w.entries.length;
    }
    return { latest, currentWeeks: weeks.filter(w => w.year === newestYear), olderYears: [...yearMap.values()] };
    // wnState, not []: window.WHATS_NEW is filled in by a lazy script tag, so a
    // memo computed once on mount would keep serving the empty snapshot it took
    // before the file landed.
  }, [wnState]);

  const rowBtn = { width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', WebkitTapHighlightColor: 'transparent' };
  const chevron = () => <svg width="5" height="9" viewBox="0 0 6 10" fill="none" stroke={UI.inkFaint} strokeWidth="1.3" strokeLinecap="round"><path d="M1 1l4 4-4 4" /></svg>;
  const badge = (n) => <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'rgba(var(--accent-rgb),0.16)', border: `1px solid rgba(var(--accent-rgb),0.4)`, borderRadius: 999, padding: '1px 8px', fontFamily: UI.fontUi }}>{n}</span>;
  const titleRow = (entry) => (
    <button onClick={() => setSelected(entry)} style={rowBtn}>
      <span style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span className="micro" style={{ color: UI.inkFaint }}>{entry.id}</span>
        {chevron()}
      </div>
    </button>
  );
  const weekRow = (w) => (
    <button onClick={() => setSelectedWeek(w)} style={rowBtn}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, overflow: 'hidden' }}>
        <span style={{ fontSize: 15, fontWeight: 500, color: UI.ink, fontFamily: UI.fontUi, whiteSpace: 'nowrap' }}>CW{w.week}-{w.year}</span>
        <span style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{changelogWeekRange(w.date)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {badge(w.entries.length)}
        {chevron()}
      </div>
    </button>
  );
  const withDividers = (nodes) => nodes.map((node, i) => (
    <div key={node.key}>{node.el}{i < nodes.length - 1 && <div className="knurl" />}</div>
  ));

  const topRows = [
    ...latest.map(e => ({ key: e.id, el: titleRow(e) })),
    ...currentWeeks.map(w => ({ key: w.key, el: weekRow(w) })),
    ...olderYears.map(yg => ({ key: 'y' + yg.year, el: (
      <button onClick={() => setSelectedYear(yg)} style={rowBtn}>
        <span style={{ fontSize: 15, fontWeight: 600, color: UI.ink, fontFamily: UI.fontUi }}>{yg.year}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{badge(yg.count)}{chevron()}</div>
      </button>
    ) })),
  ];
  const earlierStart = latest.length; // index where the grouped-by-week section begins

  return (
    <>
      <SettingsSheet open={open} onClose={handleClose} title="Changelog">
        <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
          {/* The changelog text is a lazy fetch, so say so instead of showing an
              empty list: an offline or flaky load is otherwise indistinguishable
              from "there are no releases", with nothing to act on. */}
          {wnState === 'loading' && !topRows.length && (
            <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, padding: '16px 0' }}>Loading…</div>
          )}
          {wnState === 'error' && !topRows.length && (
            <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi }}>Couldn't load the changelog.</div>
              <button onClick={retryWhatsNew} style={accentBtn}>Retry</button>
            </div>
          )}
          {topRows.map((node, i) => (
            <React.Fragment key={node.key}>
              {i === earlierStart && topRows.length > earlierStart && (
                <div className="micro" style={{ color: UI.inkFaint, padding: '16px 0 6px' }}>Earlier</div>
              )}
              {node.el}
              {i < topRows.length - 1 && i + 1 !== earlierStart && <div className="knurl" />}
            </React.Fragment>
          ))}
        </div>
      </SettingsSheet>

      {/* Older year -> its weeks */}
      <SettingsSheet open={!!selectedYear} onClose={() => setSelectedYear(null)} title={selectedYear ? String(selectedYear.year) : ''}>
        <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
          {withDividers((selectedYear?.weeks || []).map(w => ({ key: w.key, el: weekRow(w) })))}
        </div>
      </SettingsSheet>

      {/* Week -> its titles */}
      <SettingsSheet open={!!selectedWeek} onClose={() => setSelectedWeek(null)} title={selectedWeek ? `CW${selectedWeek.week}-${selectedWeek.year}` : ''}>
        <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
          {withDividers((selectedWeek?.entries || []).map(e => ({ key: e.id, el: titleRow(e) })))}
        </div>
      </SettingsSheet>

      {/* Entry -> its message */}
      <SettingsSheet open={!!selected} onClose={() => setSelected(null)} title={selected?.title || ''}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 8 }}>
          {/* An item is normally a plain string; { text, emphasis: true } opts
              one item into a bolder treatment (same contract and shape as
              WhatsNewModal, app.jsx, which is where this shape was introduced,
              this sheet renders the identical window.WHATS_NEW data and must
              handle it the same way, rendering the raw object crashes React). */}
          {(selected?.items || []).map((item, j) => {
            const emphasis = item && typeof item === 'object';
            const text = emphasis ? item.text : item;
            return (
              <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--accent)', fontSize: 11, marginTop: 3, flexShrink: 0 }}>•</span>
                <span style={{ fontSize: emphasis ? 14 : 13, fontWeight: emphasis ? 700 : 400, color: emphasis ? UI.ink : UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.55 }}>{text}</span>
              </div>
            );
          })}
        </div>
      </SettingsSheet>
    </>
  );
}

// ─── PASSKEY SHEET ───────────────────────────────────────────────────
function PasskeySheet({ open, onClose }) {
  const [confirmEl, confirm] = useConfirm();
  const [passkeys, setPasskeys] = useStateSet([]);
  const [loadingList, setLoadingList] = useStateSet(false);
  const [adding, setAdding] = useStateSet(false);
  const [deletingId, setDeletingId] = useStateSet(null);
  const [editingId, setEditingId] = useStateSet(null);
  const [editName, setEditName] = useStateSet('');
  const [renaming, setRenaming] = useStateSet(false);
  const [error, setError] = useStateSet('');
  const [successMsg, setSuccessMsg] = useStateSet('');

  const flash = (msg, isError = false) => {
    if (isError) setError(msg); else setSuccessMsg(msg);
    setTimeout(() => { setError(''); setSuccessMsg(''); }, 3500);
  };

  const loadPasskeys = async () => {
    setLoadingList(true);
    try {
      const list = await LB.listPasskeys();
      setPasskeys(list);
    } catch (e) {
      flash(e.message || 'Failed to load passkeys', true);
    } finally {
      setLoadingList(false);
    }
  };

  useEffectSet(() => {
    if (open) loadPasskeys();
    else { setPasskeys([]); setError(''); setSuccessMsg(''); setEditingId(null); setEditName(''); }
  }, [open]);

  const handleAdd = async () => {
    if (adding) return;
    setAdding(true); setError('');
    try {
      await LB.registerPasskey();
      flash('Passkey added!');
      loadPasskeys();
    } catch (e) {
      flash(e.message || 'Failed to add passkey', true);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (deletingId) return;
    const ok = await confirm(`Remove "${name || 'Passkey'}"? You won't be able to sign in with it anymore.`, { ok: 'Remove', danger: true });
    if (!ok) return;
    setDeletingId(id);
    try {
      await LB.deletePasskey(id);
      setPasskeys(prev => prev.filter(p => p.id !== id));
      flash('Passkey removed');
    } catch (e) {
      flash(e.message || 'Failed to remove passkey', true);
    } finally {
      setDeletingId(null);
    }
  };

  const startEdit = (pk) => { setEditingId(pk.id); setEditName(pk.friendly_name || ''); };
  const cancelEdit = () => { setEditingId(null); setEditName(''); };

  const handleRename = async (id) => {
    const name = editName.trim();
    if (!name || renaming) return;
    setRenaming(true);
    try {
      await LB.updatePasskey(id, name);
      setPasskeys(prev => prev.map(p => p.id === id ? { ...p, friendly_name: name } : p));
      setEditingId(null); setEditName('');
      flash('Passkey renamed');
    } catch (e) {
      flash(e.message || 'Failed to rename passkey', true);
    } finally {
      setRenaming(false);
    }
  };

  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <SettingsSheet open={open} onClose={onClose} title="Passkeys">
      {confirmEl}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <button onClick={handleAdd} disabled={adding} style={{
          width: '100%', padding: '12px 0', borderRadius: 6,
          background: 'rgba(var(--accent-rgb),0.10)', border: 'var(--hair-width) solid rgba(var(--accent-rgb),0.25)',
          color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600,
          cursor: adding ? 'default' : 'pointer', opacity: adding ? 0.6 : 1,
          WebkitTapHighlightColor: 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {adding ? 'Adding…' : 'Add passkey for this device'}
        </button>

        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 8, marginBottom: 20, lineHeight: 1.5 }}>
          Each device needs its own passkey, Face ID, Touch ID or device PIN.
        </div>

        {(error || successMsg) && (
          <div style={{ fontSize: 12, color: error ? UI.danger : UI.gold, fontFamily: UI.fontUi, marginBottom: 12, padding: '8px 12px', background: error ? 'rgba(var(--danger-rgb),0.06)' : 'rgba(var(--accent-rgb),0.16)', borderRadius: 6 }}>
            {error || successMsg}
          </div>
        )}

        {loadingList ? (
          <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '16px 0' }}>Loading…</div>
        ) : passkeys.length === 0 ? (
          <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '16px 0' }}>No passkeys registered yet</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="micro" style={{ color: UI.inkFaint, marginBottom: 10 }}>Registered passkeys</div>
            {passkeys.map((pk, i) => (
              <React.Fragment key={pk.id}>
                {i > 0 && <div className="knurl" />}
                {editingId === pk.id ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0' }}>
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleRename(pk.id); if (e.key === 'Escape') cancelEdit(); }}
                      placeholder="Passkey name"
                      autoFocus
                      style={{ ...SETTINGS_INPUT_STYLE, flex: 1, padding: '7px 10px', fontSize: 13 }}
                    />
                    <button onClick={() => handleRename(pk.id)} disabled={!editName.trim() || renaming} aria-label="Save name" style={{
                      background: 'rgba(var(--accent-rgb),0.16)', border: '1px solid rgba(var(--accent-rgb),0.4)',
                      color: 'var(--accent)', borderRadius: 6, width: 32, height: 32, flexShrink: 0,
                      cursor: renaming ? 'default' : 'pointer', opacity: editName.trim() ? 1 : 0.5,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
                    }}>
                      <i className={`fa-solid ${renaming ? 'fa-spinner fa-spin' : 'fa-check'}`} style={{ fontSize: 13 }} />
                    </button>
                    <button onClick={cancelEdit} disabled={renaming} aria-label="Cancel" style={{
                      background: 'none', border: `var(--hair-width) solid ${UI.hairStrong}`,
                      color: UI.inkFaint, borderRadius: 6, width: 32, height: 32, flexShrink: 0,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
                    }}>
                      <i className="fa-solid fa-xmark" style={{ fontSize: 13 }} />
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 0' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {pk.friendly_name || 'Passkey'}
                      </div>
                      <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 2 }}>
                        Added {fmtDate(pk.created_at)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => startEdit(pk)} disabled={!!deletingId} aria-label="Rename" style={{
                        background: 'none', border: `var(--hair-width) solid ${UI.hairStrong}`,
                        color: UI.inkSoft, borderRadius: 6, width: 30, height: 30,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
                      }}>
                        <i className="fa-solid fa-pen" style={{ fontSize: 11 }} />
                      </button>
                      <button onClick={() => handleDelete(pk.id, pk.friendly_name)} disabled={!!deletingId} style={{
                        background: 'rgba(var(--danger-rgb),0.08)', border: 'var(--hair-width) solid rgba(var(--danger-rgb),0.2)',
                        color: UI.danger, borderRadius: 6, padding: '5px 12px',
                        fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                        cursor: deletingId ? 'default' : 'pointer', opacity: deletingId === pk.id ? 0.5 : 1,
                        WebkitTapHighlightColor: 'transparent',
                      }}>
                        {deletingId === pk.id ? '…' : 'Remove'}
                      </button>
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </SettingsSheet>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────
function SettingsScreen({ store, setStore, go, userId, runtimeConfig, syncStatus, openSupportInbox, openSupportSheet, onTestUpdateBanner, flushBeforeSignOut, markIntentionalSignOut }) {
  const [confirmEl, confirm] = useConfirm();
  const [nickname, setNickname] = useStateSet(store.user?.name || '');

  // Category sheets
  const [coachingSheet, setCoachingSheet] = useStateSet(false);
  const [driveStatus, setDriveStatus] = useStateSet(null);
  const [driveLoading, setDriveLoading] = useStateSet(false);
  const [driveMessage, setDriveMessage] = useStateSet(null);
  const [friendsSheet, setFriendsSheet] = useStateSet(false);
  const [friendsSharingSheet, setFriendsSharingSheet] = useStateSet(false);
  const [friendsNotificationsSheet, setFriendsNotificationsSheet] = useStateSet(false);
  const [socialProfileDraft, setSocialProfileDraft] = useStateSet(null);
  const [socialProfileSaving, setSocialProfileSaving] = useStateSet(false);
  const [socialProfileMsg, setSocialProfileMsg] = useStateSet(null);
  const [socialProfileLoadError, setSocialProfileLoadError] = useStateSet(null);
  const [socialProfileLoading, setSocialProfileLoading] = useStateSet(false);
  const [socialProfileRetry, setSocialProfileRetry] = useStateSet(0);
  const [healthSheet, setHealthSheet] = useStateSet(false);
  const [healthCardsSheet, setHealthCardsSheet] = useStateSet(false);
  const [glucoseSheet, setGlucoseSheet] = useStateSet(false);
  const [bodyTempSheet, setBodyTempSheet] = useStateSet(false);
  // Health sheet's three sub-categories: Health (glucose/body temp/cards),
  // Water (the same hub/settings bodies the Water tracker's own settings
  // sheet uses, from screens-water.jsx, reused verbatim rather than
  // duplicated) and Food (meal planning/reminders). waterGoalSheet/
  // waterBottleSheet/waterRemindersSheet/waterDrinksConfigSheet are each a
  // push/pop off waterSubSheet, same as they are off the Water screen's own
  // settings sheet, never a third simultaneous layer.
  const [healthSubSheet, setHealthSubSheet] = useStateSet(false);
  const [waterSubSheet, setWaterSubSheet] = useStateSet(false);
  const [waterGoalSheet, setWaterGoalSheet] = useStateSet(false);
  const [waterBottleSheet, setWaterBottleSheet] = useStateSet(false);
  const [waterRemindersSheet, setWaterRemindersSheet] = useStateSet(false);
  const [dailyLogReminderSheet, setDailyLogReminderSheet] = useStateSet(false);
  const [waterDrinksConfigSheet, setWaterDrinksConfigSheet] = useStateSet(false);
  const [foodSubSheet, setFoodSubSheet] = useStateSet(false);
  const [mealPlanningSheet, setMealPlanningSheet] = useStateSet(false);
  const [mealTimesSheet, setMealTimesSheet] = useStateSet(false);
  const [fastingSheet, setFastingSheet] = useStateSet(false);
  // Custom long fast hours (stored in the id as 'custom:N'); 48h default.
  // Parsed by the single shared LB.fastingCustomHours (same source the food
  // card's protocol resolver uses).
  const [fastingCustomHours, setFastingCustomHours] = useStateSet(() => LB.fastingCustomHours(store.settings?.fastingProtocol));
  const fastingCustomActive = typeof store.settings?.fastingProtocol === 'string' && store.settings.fastingProtocol.startsWith('custom:');
  // Own card per protocol instead of one fused segmented bar: each option
  // gets a real tap target and a clear selected state (accent border + tint,
  // same rgba(--accent-rgb) recipe Card's own `accent` variant uses), rather
  // than four labels squeezed into one thin strip.
  const fastingChip = (active) => ({
    padding: '14px 8px', borderRadius: 4, textAlign: 'center',
    border: `1.5px solid ${active ? 'var(--accent)' : UI.hairStrong}`,
    background: active ? 'rgba(var(--accent-rgb),0.13)' : UI.bgInset,
    color: active ? 'var(--accent)' : UI.ink,
    textShadow: 'none',
    fontFamily: UI.fontUi, fontSize: 13, fontWeight: 700, letterSpacing: '0.02em',
    cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
  });
  const [medsSubSheet, setMedsSubSheet] = useStateSet(false);
  const [pillboxSheet, setPillboxSheet] = useStateSet(false);
  // Food tracker meal categories. The resolved list keeps old six-number
  // mealWindows users working while the richer config carries custom labels
  // and category counts.
  const mealCats = LB.mealCategories(store.settings);
  const [mealCategoryDraft, setMealCategoryDraft] = useStateSet(null);
  const normalizeMealCategories = (categories) => (categories || []).map((c, i) => ({
    id: String(c.id || `meal-${i + 1}`),
    label: String(c.label || '').trim().slice(0, 40) || `Meal ${i + 1}`,
    startHour: Number.isInteger(c.startHour) ? c.startHour : 0,
  })).sort((a, b) => a.startHour - b.startHour);
  useEffectSet(() => {
    if (!mealTimesSheet) { setMealCategoryDraft(null); return; }
    setMealCategoryDraft(LB.mealCategories(store.settings).map(c => ({ id: c.id, label: c.label, startHour: c.startHour })));
  }, [mealTimesSheet]);

  const draftMealCats = mealCategoryDraft || mealCats.map(c => ({ id: c.id, label: c.label, startHour: c.startHour }));
  const defaultMealCats = LB.mealCategories({}).map(c => ({ id: c.id, label: c.label, startHour: c.startHour }));
  const mealCategoriesCustomized = JSON.stringify(normalizeMealCategories(mealCats)) !== JSON.stringify(normalizeMealCategories(defaultMealCats));
  const persistMealCategories = (categories) => {
    const next = normalizeMealCategories(categories);
    if (next.length) next[0].startHour = 0;
    setMealCategoryDraft(next);
    setStore(s => ({ ...s, settings: {
      ...s.settings,
      mealCategories: next,
      // Keep the old time-only setting in sync for older clients that do not
      // know about custom labels or category counts yet.
      mealWindows: next.map(c => c.startHour),
    } }));
  };
  const closeMealTimes = () => {
    const next = normalizeMealCategories(mealCategoryDraft);
    const current = normalizeMealCategories(mealCats);
    if (next.length && JSON.stringify(next) !== JSON.stringify(current)) persistMealCategories(next);
    setMealTimesSheet(false);
  };
  const updateMealCategoryLabel = (idx, label) => {
    setMealCategoryDraft(list => (list || draftMealCats).map((c, i) => i === idx ? { ...c, label } : c));
  };
  // Moves one meal's start hour without allowing empty/overlapping ranges.
  const shiftMealStart = (idx, delta) => {
    const starts = draftMealCats.map(c => c.startHour);
    if (idx === 0 || starts[idx] == null) return;
    const lo = starts[idx - 1] + 1;
    const hi = idx === starts.length - 1 ? 23 : starts[idx + 1] - 1;
    const next = Math.min(hi, Math.max(lo, starts[idx] + delta));
    if (next === starts[idx]) return;
    const categories = draftMealCats.map((c, i) => i === idx ? { ...c, startHour: next } : c);
    persistMealCategories(categories);
  };
  const addMealCategory = () => {
    if (draftMealCats.length >= 24) return;
    let bestStart = null;
    let bestGap = 1;
    draftMealCats.forEach((cat, i) => {
      const end = i === draftMealCats.length - 1 ? 24 : draftMealCats[i + 1].startHour;
      const gap = end - cat.startHour;
      if (gap > bestGap) {
        bestGap = gap;
        bestStart = Math.floor((cat.startHour + end) / 2);
      }
    });
    if (bestStart == null) return;
    persistMealCategories([...draftMealCats, { id: LB.uid(), label: `Meal ${draftMealCats.length + 1}`, startHour: bestStart }]);
  };
  const removeMealCategory = (idx) => {
    if (draftMealCats.length <= 1) return;
    const next = draftMealCats.filter((_, i) => i !== idx);
    if (next[0]) next[0] = { ...next[0], startHour: 0 };
    persistMealCategories(next);
  };
  const resetMealCategories = () => {
    setMealCategoryDraft(LB.mealCategories({}).map(c => ({ id: c.id, label: c.label, startHour: c.startHour })));
    setStore(s => ({ ...s, settings: { ...s.settings, mealCategories: null, mealWindows: null } }));
  };
  const mealStepBtn = (disabled) => ({
    width: 28, height: 28, flexShrink: 0, borderRadius: 4,
    border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent',
    color: disabled ? UI.inkGhost : UI.inkSoft, cursor: disabled ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', WebkitTapHighlightColor: 'transparent',
  });
  const [accountSheet, setAccountSheet] = useStateSet(false);
  const [xHandleDraft, setXHandleDraft] = useStateSet(() => store.user?.xHandle || '');
  const [xHandlePublicDraft, setXHandlePublicDraft] = useStateSet(() => store.user?.xHandlePublic !== false);
  const [xHandleMsg, setXHandleMsg] = useStateSet(null);
  const [trainingSheet, setTrainingSheet] = useStateSet(false);
  const [appearanceSheet, setAppearanceSheet] = useStateSet(false);
  const [dataSheet, setDataSheet] = useStateSet(false);
  const [changelogSheet, setChangelogSheet] = useStateSet(false);
  // The Changelog row's version hint reads window.WHATS_NEW inline, which is a
  // lazy script now: without this the hint is silently blank on any boot where
  // app.jsx's own What's New effect hasn't fetched it (still in flight, or
  // skipped entirely because it deferred to onboarding). The ensure call is
  // deduped, so this shares one request with ChangelogSheet's own fetch.
  const [whatsNewLoaded, setWhatsNewLoaded] = useStateSet(!!window.WHATS_NEW);
  useEffectSet(() => {
    if (whatsNewLoaded) return;
    let live = true;
    window.__ensureWhatsNew().then(() => { if (live) setWhatsNewLoaded(true); }).catch(() => {});
    return () => { live = false; };
  }, [whatsNewLoaded]);
  const [activeUsersSheet, setActiveUsersSheet] = useStateSet(false);
  const [howToSheet, setHowToSheet] = useStateSet(false);

  // Training sub-sheets
  const [sessionBehaviourSheet, setSessionBehaviourSheet] = useStateSet(false);
  const [weightsProgressionSheet, setWeightsProgressionSheet] = useStateSet(false);
  const [notificationsGroupSheet, setNotificationsGroupSheet] = useStateSet(false);
  const [restSheet, setRestSheet] = useStateSet(false);
  const [timeoutSheet, setTimeoutSheet] = useStateSet(false);
  const [paceguardSheet, setPaceguardSheet] = useStateSet(false);
  const [progressionSheet, setProgressionSheet] = useStateSet(false);
  const [progConfigOpen, setProgConfigOpen] = useStateSet(false);
  const [plateInventoryOpen, setPlateInventoryOpen] = useStateSet(false);
  const [plateInvTab, setPlateInvTab] = useStateSet(() => UI.unit() === 'lbs' ? 1 : 0);
  const [progDisclaimer, setProgDisclaimer] = useStateSet(false);
  const [activeSessions, setActiveSessions] = useStateSet([]);
  const [activeGrants, setActiveGrants] = useStateSet([]);
  const [newGrantEmail, setNewGrantEmail] = useStateSet('');
  const [hasActiveUsersAccess, setHasActiveUsersAccess] = useStateSet(
    () => localStorage.getItem('logbook-active-users-access') === 'true'
  );
  const [periodsSheet, setPeriodsSheet] = useStateSet(false);
  const [showAllPeriods, setShowAllPeriods] = useStateSet(false);
  const [confirmDeletePeriodId, setConfirmDeletePeriodId] = useStateSet(null);
  const [allUsers, setAllUsers] = useStateSet([]);
  const [allUsersSheet, setAllUsersSheet] = useStateSet(false);
  const [allUsersSearch, setAllUsersSearch] = useStateSet('');
  const [allUsersNewOnly, setAllUsersNewOnly] = useStateSet(false);
  const [allUsersOnboardedOnly, setAllUsersOnboardedOnly] = useStateSet(false);
  const [allUsersOutdatedOnly, setAllUsersOutdatedOnly] = useStateSet(false);
  const [allUsersRecentOnly, setAllUsersRecentOnly] = useStateSet(false);
  const [adminUserDetail, setAdminUserDetail] = useStateSet(null); // { userId, name, plans }
  const [adminUserDetailLoading, setAdminUserDetailLoading] = useStateSet(false);
  const [adminUserDetailSheet, setAdminUserDetailSheet] = useStateSet(false);
  const [adminPlanDetail, setAdminPlanDetail] = useStateSet(null); // plan object with days
  const [adminPlanDetailSheet, setAdminPlanDetailSheet] = useStateSet(false);
  const [adminPlanSelectedDayId, setAdminPlanSelectedDayId] = useStateSet(null);
  useEffectSet(() => {
    setAdminPlanSelectedDayId(adminPlanDetail?.days?.[0]?.id || null);
  }, [adminPlanDetail]);
  // Only the recent window can ever be considered "new" (NEW_SIGNUP_DAYS
  // below), so retaining an unbounded list of historical user ids has no
  // functional value. Keep a generous tail for slow admin devices.
  const SEEN_SIGNUPS_MAX = 1000;
  const [seenSignups, setSeenSignups] = useStateSet(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('logbook-seen-signups') || '[]');
      return new Set((Array.isArray(parsed) ? parsed : []).slice(-SEEN_SIGNUPS_MAX));
    } catch (_) { return new Set(); }
  });
  const [nowS, setNowS] = useStateSet(Date.now());
  const [importing, setImporting] = useStateSet(false);
  const [importSheet, setImportSheet] = useStateSet(false);
  const [importProgress, setImportProgress] = useStateSet({ pct: 0, phase: '' });
  const [migrationSheet, setMigrationSheet] = useStateSet(false);
  const [workoutImportSheet, setWorkoutImportSheet] = useStateSet(false);
  const [workoutImportLoading, setWorkoutImportLoading] = useStateSet(false);
  const [workoutImportProgress, setWorkoutImportProgress] = useStateSet({ pct: 0, phase: '' });
  const [workoutImportPreview, setWorkoutImportPreview] = useStateSet(null);
  const [workoutImportError, setWorkoutImportError] = useStateSet(null);
  const [workoutImportStep, setWorkoutImportStep] = useStateSet(1);
  const [workoutImportPreviewIndex, setWorkoutImportPreviewIndex] = useStateSet(0);
  const [workoutImportDuplicateMode, setWorkoutImportDuplicateMode] = useStateSet('skip');
  const [workoutImportUnknownMode, setWorkoutImportUnknownMode] = useStateSet('create');
  const [workoutImportSaving, setWorkoutImportSaving] = useStateSet(false);
  const [planImportSheet, setPlanImportSheet] = useStateSet(false);
  const [planImportLoading, setPlanImportLoading] = useStateSet(false);
  const [planImportProgress, setPlanImportProgress] = useStateSet({ pct: 0, phase: '' });
  const [planImportPreview, setPlanImportPreview] = useStateSet(null);
  const [planImportError, setPlanImportError] = useStateSet(null);
  const [planImportStep, setPlanImportStep] = useStateSet(1);
  const [planImportDayIndex, setPlanImportDayIndex] = useStateSet(0);
  const [planImportSaving, setPlanImportSaving] = useStateSet(false);
  // Did step 1 of the restore flow actually produce a file in this sheet visit?
  const [backupOk, setBackupOk] = useStateSet(false);
  const [exportingTraining, setExportingTraining] = useStateSet(false);
  const [trainingExportSheet, setTrainingExportSheet] = useStateSet(false);
  const [exportFormat, setExportFormat] = useStateSet('csv'); // 'csv' | 'xlsx' | 'pdf'
  const [exportRange, setExportRange] = useStateSet('30'); // '7' | '30' | 'custom' | 'all'
  const [exportFrom, setExportFrom] = useStateSet(() => LB.shiftDate(LB.todayISO(), -29));
  const [exportTo, setExportTo] = useStateSet(() => LB.todayISO());
  // Weight axis only: 'mixed' is kg on the weight side, and the picker below
  // offers exactly kg / lbs. Seeding this with the raw setting left a 'mixed'
  // user with neither button selected and a bogus unit mismatch on import.
  const [importSourceUnit, _setImportSourceUnit] = useStateSet(LB.weightAxisUnit(store.settings?.unit));
  const importSourceUnitRef = useRefSet(LB.weightAxisUnit(store.settings?.unit));
  const setImportSourceUnit = v => { importSourceUnitRef.current = v; _setImportSourceUnit(v); };
  const [pushStatus, setPushStatus] = useStateSet(null);
  const [pushEnabled, setPushEnabled] = useStateSet(() => store.settings?.pushEnabled ?? localStorage.getItem('logbook-push-enabled') === 'true');
  const [pushKeyDraft, setPushKeyDraft] = useStateSet('');
  const [testPickerOpen, setTestPickerOpen] = useStateSet(false);
  const [advancedPushSheet, setAdvancedPushSheet] = useStateSet(false);
  const [pushoverStep, setPushoverStep] = useStateSet('idle'); // 'idle'|'entering-key'|'code-sent'
  const [pendingCode, setPendingCode] = useStateSet('');
  const [codeInput, setCodeInput] = useStateSet('');
  const [verifyLoading, setVerifyLoading] = useStateSet(false);
  const [pushSheet, setPushSheet] = useStateSet(false);
  const [webPushSub, setWebPushSub] = useStateSet(null);
  const [webPushLoading, setWebPushLoading] = useStateSet(false);
  const [webPushPending, setWebPushPending] = useStateSet(false);
  const [webPushVerified, setWebPushVerified] = useStateSet(() => localStorage.getItem('logbook-push-verified') === 'true');
  const [iosDisclaimerSeen, setIosDisclaimerSeen] = useStateSet(() => localStorage.getItem('logbook-push-ios-hint-seen') === 'true');
  const [webPushStep, setWebPushStep] = useStateSet('idle'); // 'idle'|'code-sent'
  const [webPushCode, setWebPushCode] = useStateSet('');
  const [reminderSheet, setReminderSheet] = useStateSet(false);
  const [passkeySheet, setPasskeySheet] = useStateSet(false);
  const [supportSheet, setSupportSheet] = useStateSet(false);
  const [guidesSheet, setGuidesSheet] = useStateSet(false);
  const [supportView, setSupportView] = useStateSet('list'); // 'list' | 'thread' | 'new'
  const [supportActiveTicketId, setSupportActiveTicketId] = useStateSet(null);
  const [supportActiveNotes, setSupportActiveNotes] = useStateSet([]);
  const [supportActiveLoading, setSupportActiveLoading] = useStateSet(false);
  const [supportDraft, setSupportDraft] = useStateSet('');
  const [supportSending, setSupportSending] = useStateSet(false);
  const [supportImageFile, setSupportImageFile] = useStateSet(null);
  const [supportImagePreview, setSupportImagePreview] = useStateSet(null);
  const [supportCategoryDraft, setSupportCategoryDraft] = useStateSet('question');
  const [supportCatFilter, setSupportCatFilter] = useStateSet('all');
  const [supportInboxSheet, setSupportInboxSheet] = useStateSet(false);
  const [supportInbox, setSupportInbox] = useStateSet([]);
  const [supportInboxLoading, setSupportInboxLoading] = useStateSet(false);
  const [supportTicket, setSupportTicket] = useStateSet(null);
  const [supportTicketNotes, setSupportTicketNotes] = useStateSet([]);
  const [lightboxSrc, setLightboxSrc] = useStateSet(null); // chat/support attachment tapped for fullscreen view
  const [supportTicketLoading, setSupportTicketLoading] = useStateSet(false);
  const [supportAdminDraft, setSupportAdminDraft] = useStateSet('');
  const [supportAdminSending, setSupportAdminSending] = useStateSet(false);
  const [supportEditingNoteId, setSupportEditingNoteId] = useStateSet(null);
  const [supportEditingBody, setSupportEditingBody] = useStateSet('');
  const [supportNoteActionBusy, setSupportNoteActionBusy] = useStateSet(false);
  const [adminImageFile, setAdminImageFile] = useStateSet(null);
  const [adminImagePreview, setAdminImagePreview] = useStateSet(null);
  const [archivedInbox, setArchivedInbox] = useStateSet([]);
  const [showArchived, setShowArchived] = useStateSet(false);
  const [archivedLoading, setArchivedLoading] = useStateSet(false);
  const [changePasswordSheet, setChangePasswordSheet] = useStateSet(false);
  const [pwCurrent, setPwCurrent] = useStateSet('');
  const [pwNew, setPwNew] = useStateSet('');
  const [pwConfirm, setPwConfirm] = useStateSet('');
  const [pwLoading, setPwLoading] = useStateSet(false);
  const [pwMsg, setPwMsg] = useStateSet(null);
  const [showPw, setShowPw] = useStateSet(false); // one eye toggles all three change-password fields
  const [changeEmailSheet, setChangeEmailSheet] = useStateSet(false);
  const [emailNew, setEmailNew] = useStateSet('');
  const [emailLoading, setEmailLoading] = useStateSet(false);
  const [emailMsg, setEmailMsg] = useStateSet(null);
  const [reminderEnabled, setReminderEnabled] = useStateSet(() => store.settings?.reminderEnabled ?? false);
  const [reminderTime, setReminderTime] = useStateSet(() => store.settings?.reminderTime ?? '07:00');
  const [dailyLogReminderEnabled, setDailyLogReminderEnabled] = useStateSet(() => store.settings?.dailyLogReminderEnabled ?? false);
  const [dailyLogReminderTime, setDailyLogReminderTime] = useStateSet(() => store.settings?.dailyLogReminderTime ?? '19:00');
  const [cycleWeekView, setCycleWeekView] = useStateSet(() => store.settings?.cycleWeekView ?? localStorage.getItem('logbook-cycle-week-view') === 'true');
  const [darkMode, setDarkMode] = useStateSet(() => store.settings?.darkMode ?? localStorage.getItem('logbook-dark-mode') ?? 'dark');
  // Paper mutes the chosen accent to grey by default (applyAccentColor,
  // index.html); this is the opt-out, local-only (no store field, nothing to
  // sync or back up), matching logbook-accent-color's own pattern.
  const [paperAccentEnabled, setPaperAccentEnabled] = useStateSet(() => localStorage.getItem('logbook-paper-accent-enabled') === 'true');
  // Grid overlay (index.html's window.applyGridPreference): local-only,
  // theme-independent. Untouched (localStorage key absent) resolves to
  // today's default (on for paper, off elsewhere) via window.__gridEnabled,
  // which applyDarkMode already recomputes on every theme switch, so this
  // just mirrors that resolved value rather than tracking the raw
  // localStorage tri-state itself.
  const [gridEnabled, setGridEnabled] = useStateSet(() => !!window.__gridEnabled);
  useEffectSet(() => { setGridEnabled(!!window.__gridEnabled); }, [darkMode]);
  // Larger text is deliberately device-local. It changes presentation only,
  // so it never enters the synced settings row or a backup.
  const [largerText, setLargerText] = useStateSet(() => localStorage.getItem('logbook-larger-text') === 'true');
  const recalibrateViewport = async () => {
    const repair = window.__zaneRecalibrateViewport;
    const ok = typeof repair === 'function' && repair();
    await confirm(
      ok
        ? 'The touch layout was recalibrated on this device. You can continue without reloading the page.'
        : 'The touch layout could not be recalibrated right now. Please try again in a moment.',
      { title: ok ? 'Layout recalibrated' : 'Recalibration unavailable', ok: 'Done', cancel: null },
    );
  };
  // Starts wherever the watermark is ALREADY sitting today (the same
  // per-theme/per-image defaults screens-home.jsx falls back to when
  // watermarkOpacity is unset), so the slider doesn't jump to an arbitrary
  // position the first time this sheet opens. Moving it makes the choice
  // explicit and portable across themes/devices from then on.
  const [watermarkOpacityPct, setWatermarkOpacityPct] = useStateSet(() => {
    const explicit = store.settings?.watermarkOpacity;
    if (explicit != null) return explicit;
    if (store.settings?.vipBackground) return 16;
    const mode = store.settings?.darkMode ?? 'dark';
    return mode === 'paper' ? (gridEnabled ? 16 : 4) : mode === 'light' ? 14 : (gridEnabled ? 12 : 4);
  });
  const [showWarmupInSummary, setShowWarmupInSummary] = useStateSet(() => store.settings?.showWarmupInSummary ?? true);
  const [unitPickerOpen, setUnitPickerOpen] = useStateSet(false);
const [adminSheet, setAdminSheet] = useStateSet(false);
  const [dbStabilitySheet, setDbStabilitySheet] = useStateSet(false);
  const [socialModeBusy, setSocialModeBusy] = useStateSet(false);
  const [socialTransportBusy, setSocialTransportBusy] = useStateSet(false);
  const [coachingTransportBusy, setCoachingTransportBusy] = useStateSet(false);
  const [dbStabilityMsg, setDbStabilityMsg] = useStateSet(null);
  const [vipBgSheet, setVipBgSheet] = useStateSet(false);
  const [vipBgListSheet, setVipBgListSheet] = useStateSet(false);
  const [vipBgList, setVipBgList] = useStateSet([]);
  const [vipBgOptions, setVipBgOptions] = useStateSet(null);
  const [vipBgEmail, setVipBgEmail] = useStateSet('');
  const [vipBgKey, setVipBgKey] = useStateSet('');
  const [vipBgSaving, setVipBgSaving] = useStateSet(false);
  const [vipBgMsg, setVipBgMsg] = useStateSet(null);
  const [broadcastSheet, setBroadcastSheet] = useStateSet(false);
  const [updateToolsSheet, setUpdateToolsSheet] = useStateSet(false);
  const [broadcastBody, setBroadcastBody] = useStateSet('');
  const [broadcastSending, setBroadcastSending] = useStateSet(false);
  const [broadcastMsg, setBroadcastMsg] = useStateSet(null);
  const [adminEmailSubject, setAdminEmailSubject] = useStateSet('');
  const [adminEmailBody, setAdminEmailBody] = useStateSet('');
  const [adminEmailSending, setAdminEmailSending] = useStateSet(false);
  const [adminEmailMsg, setAdminEmailMsg] = useStateSet(null);
  const isAdmin = store.user?.email === 'office@btc-prime.biz';
  // Detected/reported in app.jsx (boot, foreground, controllerchange), this
  // screen only reads it for display, so it stays fresh even if Settings is
  // never opened.
  const swVersion = store.settings?.swVersion || '';
  const socialMetricCatalog = LB.socialMetricCatalog || [];

  useEffectSet(() => {
    if (!accountSheet) return;
    setXHandleDraft(store.user?.xHandle || '');
    setXHandlePublicDraft(store.user?.xHandlePublic !== false);
    setXHandleMsg(null);
  }, [accountSheet]);

  useEffectSet(() => {
    if (!friendsSheet) return;
    // Friends loads asynchronously when the feature is enabled. Do not turn
    // that loading gap into an empty draft: saving one would overwrite the
    // user's visible profile with blank defaults before the dashboard arrives.
    const friendsSnapshotLoaded = !!store.friends?.loadedAt;
    const profile = store.friends?.profile;
    if (!friendsSnapshotLoaded) {
      setSocialProfileDraft(null);
      setSocialProfileMsg(null);
      return;
    }
    setSocialProfileLoadError(null);
    setSocialProfileLoading(false);
    setSocialProfileDraft(profile || { handle: '', friendCode: '', stepsVisible: false, workoutsVisible: false, adherenceVisible: false, metricVisibility: {}, metricSlots: LB.socialDefaultMetricSlots || ['steps', 'workouts', 'adherence'] });
    setSocialProfileMsg(null);
  }, [friendsSheet, !!store.friends?.loadedAt, store.friends?.profile?.handle, store.friends?.profile?.friendCode, store.friends?.profile?.stepsVisible, store.friends?.profile?.workoutsVisible, store.friends?.profile?.adherenceVisible, JSON.stringify(store.friends?.profile?.metricVisibility || {}), JSON.stringify(store.friends?.profile?.metricSlots || [])]);

  useEffectSet(() => {
    if (!friendsSheet || !store.settings?.showFriendsTab || store.friends?.loadedAt || !userId) return;
    let live = true;
    setSocialProfileLoading(true);
    setSocialProfileLoadError(null);
    LB.loadFriendsState(userId, LB.socialWeekStartISO(new Date(), store.settings?.weekStartDay), { force: socialProfileRetry > 0 }).then(friends => {
      if (live) setStore(s => s ? {
        ...s,
        friends: {
          ...friends,
          liveWorkouts: s.friends?.liveWorkouts || [],
          workoutHistory: s.friends?.workoutHistory || [],
        },
      } : s);
    }).catch(e => {
      if (live) setSocialProfileLoadError(e.message || 'Could not load your social profile.');
    }).finally(() => {
      if (live) setSocialProfileLoading(false);
    });
    return () => { live = false; };
  }, [friendsSheet, store.settings?.showFriendsTab, store.settings?.weekStartDay, !!store.friends?.loadedAt, userId, socialProfileRetry]);

  const saveSocialProfile = async next => {
    if (!next || socialProfileSaving) return;
    if (!store.friends?.loadedAt) {
      setSocialProfileMsg({ ok: false, text: 'Loading your social profile. Please try again in a moment.' });
      return;
    }
    setSocialProfileSaving(true);
    setSocialProfileMsg(null);
    try {
      const profile = await LB.updateSocialProfile(userId, next);
      setSocialProfileDraft(profile);
      setStore(s => s?.friends ? { ...s, friends: { ...s.friends, profile } } : s);
      setSocialProfileMsg({ ok: true, text: 'Social profile saved.' });
    } catch (e) {
      setSocialProfileMsg({ ok: false, text: e.message || 'Could not save social profile.' });
    } finally {
      setSocialProfileSaving(false);
    }
  };

  const toggleSocialMetric = async metric => {
    if (!socialProfileDraft || socialProfileSaving) return;
    const visible = !!socialProfileDraft.metricVisibility?.[metric.key];
    const nextVisibility = { ...(socialProfileDraft.metricVisibility || {}), [metric.key]: !visible };
    const next = {
      ...socialProfileDraft,
      metricVisibility: nextVisibility,
      ...(metric.key === 'steps' ? { stepsVisible: !visible } : {}),
      ...(metric.key === 'workouts' ? { workoutsVisible: !visible } : {}),
      ...(metric.key === 'adherence' ? { adherenceVisible: !visible } : {}),
    };
    setSocialProfileDraft(next);
    setSocialProfileSaving(true);
    setSocialProfileMsg(null);
    try {
      const profile = await LB.updateSocialMetricPreferences(userId, {
        metricVisibility: nextVisibility,
        metricSlots: next.metricSlots || LB.socialDefaultMetricSlots,
      });
      setSocialProfileDraft(profile);
      setStore(s => s?.friends ? { ...s, friends: { ...s.friends, profile } } : s);
      setSocialProfileMsg({ ok: true, text: 'Metric sharing saved.' });
    } catch (e) {
      setSocialProfileMsg({ ok: false, text: e.message || 'Could not save metric sharing.' });
    } finally {
      setSocialProfileSaving(false);
    }
  };

  const closeFriendsSettings = () => {
    setFriendsSharingSheet(false);
    setFriendsNotificationsSheet(false);
    setFriendsSheet(false);
  };

  const saveXHandle = () => {
    const raw = xHandleDraft.trim();
    if (!raw) {
      setStore(s => s ? { ...s, user: { ...s.user, xHandle: null, xHandlePublic: xHandlePublicDraft, xHandlePromptOptedOut: true } } : s);
      setXHandleDraft('');
      setXHandleMsg({ ok: true, text: 'X handle removed. We will not ask again automatically.' });
      return;
    }
    const normalized = LB.normalizeXHandle(raw);
    if (!normalized) {
      setXHandleMsg({ ok: false, text: 'Enter a valid X handle, for example @yourname.' });
      return;
    }
    setStore(s => s ? { ...s, user: { ...s.user, xHandle: normalized, xHandlePublic: xHandlePublicDraft, xHandlePromptOptedOut: true } } : s);
    setXHandleDraft(normalized);
    setXHandleMsg({ ok: true, text: 'X handle saved.' });
  };

  const toggleXHandlePublic = () => {
    const next = !xHandlePublicDraft;
    setXHandlePublicDraft(next);
    setStore(s => s ? { ...s, user: { ...s.user, xHandlePublic: next } } : s);
  };

  const optOutXHandle = () => {
    setXHandleDraft('');
    setXHandlePublicDraft(false);
    setStore(s => s ? { ...s, user: { ...s.user, xHandle: null, xHandlePublic: false, xHandlePromptOptedOut: true } } : s);
    setXHandleMsg({ ok: true, text: 'Got it. We will not ask again.' });
  };

  useEffectSet(() => {
    if (openSupportInbox && isAdmin) setSupportInboxSheet(true);
    if (openSupportSheet && !isAdmin) setSupportSheet(true);
  }, []);

  useEffectSet(() => {
    let mounted = true;
    LB.supabase.rpc('check_active_users_access')
      .then(({ data }) => { const val = !!data; localStorage.setItem('logbook-active-users-access', String(val)); if (mounted) setHasActiveUsersAccess(val); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  useEffectSet(() => {
    if (!hasActiveUsersAccess) return;
    let mounted = true;
    const loadSessions = () => LB.supabase.rpc('get_active_sessions_overview').then(({ data }) => { if (mounted) setActiveSessions(data || []); }).catch(() => {});
    const loadGrants = () => LB.supabase.rpc('get_active_users_grants').then(({ data }) => { if (mounted) setActiveGrants((data || []).map(r => r.email)); }).catch(() => {});
    loadSessions(); if (isAdmin) { loadGrants(); }
    // 2s only while the sheet is actually open (that view has live timers); a
    // slow heartbeat otherwise, just to keep the badge count honest. This used
    // to hammer the RPC every 2 seconds for as long as the Settings screen was
    // mounted, sheet open or not.
    const period = activeUsersSheet ? 2000 : 60000;
    const iv = setInterval(() => { loadSessions(); setNowS(Date.now()); }, period);
    return () => { mounted = false; clearInterval(iv); };
  }, [hasActiveUsersAccess, isAdmin, activeUsersSheet]);

  useEffectSet(() => {
    if (!pushSheet) return;
    LB.getWebPushSubscription().then(sub => {
      setWebPushSub(sub);
      // Auto-restore verified state: if the browser's PushManager has an active
      // subscription and push is already confirmed in DB, restore local verified flag
      // without requiring re-verification (cache clear, PWA reinstall, etc.).
      if (sub && store.settings?.pushEnabled && localStorage.getItem('logbook-push-verified') !== 'true') {
        setWebPushVerified(true);
        localStorage.setItem('logbook-push-verified', 'true');
      }
    }).catch(() => {});
  }, [pushSheet]);

  // Reset support navigation when sheet closes; clear unread badge when opened
  useEffectSet(() => {
    if (!supportSheet) {
      setSupportView('list');
      setSupportActiveTicketId(null);
      setSupportActiveNotes([]);
      setSupportDraft('');
    } else {
      setStore(s => s ? { ...s, supportUnread: 0 } : s);
    }
  }, [supportSheet]);

  // Load notes + mark read when a user opens a ticket. Private Broadcast
  // invalidations refresh the open thread; the slow poll remains a recovery
  // path for a suspended or reconnecting channel.
  // `first` gates the loading spinner + support-ticket-list badge clear to
  // just the initial open, so background refreshes don't flash "Loading…" or
  // redundantly re-zero an already-cleared unread count.
  useEffectSet(() => {
    if (!supportActiveTicketId) { setSupportActiveNotes([]); return; }
    let mounted = true;
    let first = true;
    const load = () => {
      if (first) setSupportActiveLoading(true);
      LB.supabase.from('zane_coaching_notes')
        .select('id, author_id, body, created_at, read_at, edited_at, attachments')
        .eq('coaching_id', supportActiveTicketId)
        .order('created_at', { ascending: true })
        .then(({ data }) => {
          if (!mounted) return;
          setSupportActiveNotes(data || []);
          if (first) setSupportActiveLoading(false);
          // Gated on the just-fetched rows actually containing an unread
          // message from the other party: without this, every 12s tick fired
          // an UPDATE that matched zero rows for as long as the sheet stayed
          // open and idle.
          const hasUnread = (data || []).some(n => n.author_id !== userId && n.read_at == null);
          if (hasUnread) LB.supabase.from('zane_coaching_notes')
            .update({ read_at: new Date().toISOString() })
            .eq('coaching_id', supportActiveTicketId)
            .neq('author_id', userId)
            .is('read_at', null)
            .then(({ error }) => { if (error || !mounted) return; setStore(s => {
              const ticket = (s.supportTickets || []).find(t => t.coachingId === supportActiveTicketId);
              const delta = ticket ? ticket.unreadCount : 0;
              return {
                ...s,
                supportUnread: Math.max(0, (s.supportUnread || 0) - delta),
                supportTickets: (s.supportTickets || []).map(t =>
                  t.coachingId === supportActiveTicketId ? { ...t, unreadCount: 0 } : t
                ),
              };
            }); });
          first = false;
        });
    };
    load();
    const onInvalidate = event => {
      const resource = event?.detail?.resource;
      if (resource === 'support' || resource === 'authoritative') load();
    };
    window.addEventListener('zane-coaching-invalidate', onInvalidate);
    const poll = setInterval(load, 60000);
    return () => {
      mounted = false;
      window.removeEventListener('zane-coaching-invalidate', onInvalidate);
      clearInterval(poll);
    };
  }, [supportActiveTicketId]);

  // Admin tickets use the same Broadcast invalidation plus a slow fallback.
  // `first` gates the loading spinner to the initial open only.
  useEffectSet(() => {
    if (!supportTicket) { setSupportTicketNotes([]); return; }
    let mounted = true;
    let first = true;
    const load = () => {
      if (first) setSupportTicketLoading(true);
      LB.supabase.from('zane_coaching_notes')
        .select('id, author_id, body, created_at, read_at, edited_at, attachments')
        .eq('coaching_id', supportTicket.coachingId)
        .order('created_at', { ascending: true })
        .then(({ data }) => {
          if (!mounted) return;
          setSupportTicketNotes(data || []);
          if (first) setSupportTicketLoading(false);
          first = false;
          // Gated on the just-fetched rows actually containing an unread
          // message from the other party, same reasoning as the client-side
          // poll above: without this, every 12s tick fired an UPDATE that
          // matched zero rows for as long as the sheet stayed open and idle.
          const hasUnread = (data || []).some(n => n.author_id !== userId && n.read_at == null);
          if (!hasUnread) return;
          LB.supabase.from('zane_coaching_notes')
            .update({ read_at: new Date().toISOString() })
            .eq('coaching_id', supportTicket.coachingId)
            .neq('author_id', userId)
            .is('read_at', null)
            .then(({ error }) => { if (error || !mounted) return; setSupportInbox(prev => prev.map(t => t.coaching_id === supportTicket.coachingId ? { ...t, unread_count: 0 } : t)); });
        });
    };
    load();
    const onInvalidate = event => {
      const resource = event?.detail?.resource;
      if (resource === 'support' || resource === 'authoritative') load();
    };
    window.addEventListener('zane-coaching-invalidate', onInvalidate);
    const poll = setInterval(load, 60000);
    return () => {
      mounted = false;
      window.removeEventListener('zane-coaching-invalidate', onInvalidate);
      clearInterval(poll);
    };
  }, [supportTicket]);

  // Admin-only: load all admin state on mount (support inbox).
  useEffectSet(() => {
    if (!isAdmin) return;
    let mounted = true;
    LB.supabase.rpc('get_support_chats').then(({ data }) => { if (mounted) setSupportInbox(data || []); }).catch(() => {});
    return () => { mounted = false; };
  }, [isAdmin]);

  // Admin-only: support inbox. Reloaded each time Account or Admin sheet opens.
  useEffectSet(() => {
    if (!isAdmin || (!accountSheet && !adminSheet)) return;
    let mounted = true;
    LB.supabase.rpc('get_support_chats').then(({ data }) => { if (mounted) setSupportInbox(data || []); }).catch(() => {});
    return () => { mounted = false; };
  }, [isAdmin, accountSheet, adminSheet]);

  // Admin-only: full user list (name/email/last-known SW version/plan count)
  //, the single source for the unseen-signup badge (computed from it) and
  // the All-users sheet, which folds in what used to be the separate Recent
  // Sign-ups/Onboarded views as client-side filters. Loaded on mount and
  // refreshed whenever Account/Admin opens, so the badge stays current.
  useEffectSet(() => {
    if (!isAdmin) return;
    let mounted = true;
    LB.supabase.rpc('get_all_users_admin').then(({ data, error }) => { if (mounted && !error) setAllUsers(data || []); }).catch(() => {});
    return () => { mounted = false; };
  }, [isAdmin, accountSheet, adminSheet]);

  // Admin-only: re-fetch every time the All-users sheet itself is opened, so
  // it never shows a stale snapshot from whenever the badge last refreshed.
  useEffectSet(() => {
    if (!isAdmin || !allUsersSheet) return;
    let mounted = true;
    LB.supabase.rpc('get_all_users_admin').then(({ data, error }) => { if (mounted && !error) setAllUsers(data || []); }).catch(() => {});
    return () => { mounted = false; };
  }, [isAdmin, allUsersSheet]);

  useEffectSet(() => {
    if (!isAdmin || !vipBgSheet) return;
    let mounted = true;
    LB.supabase.rpc('get_user_vip_backgrounds').then(({ data }) => { if (mounted) setVipBgList(data || []); }).catch(() => {});
    fetch('Background/index.json?_v=' + Date.now()).then(r => r.json()).then(data => { if (mounted) setVipBgOptions(data); }).catch(() => { if (mounted) setVipBgOptions([]); });
    return () => { mounted = false; };
  }, [isAdmin, vipBgSheet]);

  useEffectSet(() => {
    if (!supportInboxSheet || !isAdmin) return;
    setSupportInboxLoading(true);
    setStore(s => s ? { ...s, adminSupportUnread: 0 } : s);
    LB.supabase.rpc('get_support_chats').then(({ data }) => { setSupportInbox(data || []); setSupportInboxLoading(false); }).catch(() => setSupportInboxLoading(false));
  }, [supportInboxSheet]);

  useEffectSet(() => {
    supportBottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [supportActiveNotes]);

  useEffectSet(() => {
    adminBottomRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [supportTicketNotes]);

  const markSignupSeen = (uid) => {
    setSeenSignups(prev => {
      const next = new Set(prev); next.add(uid);
      const bounded = [...next].slice(-SEEN_SIGNUPS_MAX);
      try { localStorage.setItem('logbook-seen-signups', JSON.stringify(bounded)); } catch (_) {}
      return new Set(bounded);
    });
  };

  const markAllSignupsSeen = (uids) => {
    if (!uids.length) return;
    setSeenSignups(prev => {
      const next = new Set(prev);
      uids.forEach(id => next.add(id));
      const bounded = [...next].slice(-SEEN_SIGNUPS_MAX);
      try { localStorage.setItem('logbook-seen-signups', JSON.stringify(bounded)); } catch (_) {}
      return new Set(bounded);
    });
  };

  // A sign-up counts as "new" only if it's both unseen on this device AND
  // registered recently, otherwise a fresh admin device would flag every
  // existing user as new.
  const NEW_SIGNUP_DAYS = 14;
  const isNewSignup = (u) => {
    if (seenSignups.has(u.user_id)) return false;
    if (!u.created_at) return false;
    return (Date.now() - new Date(u.created_at).getTime()) < NEW_SIGNUP_DAYS * 24 * 60 * 60 * 1000;
  };

  const addGrant = async () => {
    const email = newGrantEmail.trim().toLowerCase();
    if (!email.includes('@') || activeGrants.includes(email)) return;
    const { error } = await LB.supabase.rpc('set_active_users_grant', { p_email: email, p_granted: true });
    if (error) { await confirm(error.message || 'Could not add this grant.', { title: 'Grant failed', ok: 'OK' }); return; }
    setActiveGrants(g => [...g, email]); setNewGrantEmail('');
  };
  const removeGrant = async (email) => {
    const { error } = await LB.supabase.rpc('set_active_users_grant', { p_email: email, p_granted: false });
    if (error) { await confirm(error.message || 'Could not remove this grant.', { title: 'Grant failed', ok: 'OK' }); return; }
    setActiveGrants(g => g.filter(x => x !== email));
  };

  const pushStatusTimer = useRefSet(null);
  const pendingTimeoutRef = useRefSet(null);
  const countdownIntervalRef = useRefSet(null);
  const supportBottomRef = useRefSet(null);
  const adminBottomRef = useRefSet(null);
  const [pendingCountdown, setPendingCountdown] = useStateSet(120);
  // Also roll back a still-pending push verification on unmount. Leaving the
  // screen mid-verification used to leave a live row in zane_push_subscriptions
  // and a real browser subscription behind, with the UI showing push as off:
  // the device kept receiving pushes nobody could turn off from here.
  const webPushPendingRef = useRefSet(false);
  useEffectSet(() => { webPushPendingRef.current = webPushPending; }, [webPushPending]);
  useEffectSet(() => () => {
    clearTimeout(pushStatusTimer.current); clearTimeout(pendingTimeoutRef.current); clearInterval(countdownIntervalRef.current);
    if (webPushPendingRef.current) {
      LB.unsubscribeWebPush(userId).catch(() => {});
      try { localStorage.setItem('logbook-push-enabled', 'false'); localStorage.removeItem('logbook-push-verified'); } catch (_) {}
    }
  }, []);

  const cancelPendingPush = async () => {
    clearTimeout(pendingTimeoutRef.current);
    clearInterval(countdownIntervalRef.current);
    setPendingCountdown(120);
    await LB.unsubscribeWebPush(userId).catch(() => {});
    setWebPushSub(null);
    setPushEnabled(false);
    setWebPushVerified(false);
    try { localStorage.setItem('logbook-push-enabled', 'false'); localStorage.removeItem('logbook-push-verified'); } catch (_) {}
    setWebPushPending(false);
    setWebPushStep('idle'); setWebPushCode(''); setCodeInput('');
  };

  // Cancel pending verification when the push sheet is closed without verifying
  useEffectSet(() => {
    if (!pushSheet && webPushPending) cancelPendingPush();
  }, [pushSheet]);

  const togglePush = async () => {
    if (webPushLoading) return;
    if (webPushPending) { await cancelPendingPush(); return; }
    setWebPushLoading(true);
    try {
      if (!pushEnabled) {
        const sub = await LB.subscribeWebPush(userId);
        setWebPushSub(sub);
        setWebPushVerified(false);
        try { localStorage.removeItem('logbook-push-verified'); } catch (_) {}
        setWebPushPending(true);
        setPendingCountdown(120);
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = setInterval(() => setPendingCountdown(n => Math.max(0, n - 1)), 1000);
        // 2-minute window to enter the verification code; cancels subscription on timeout
        pendingTimeoutRef.current = setTimeout(async () => {
          await cancelPendingPush();
          clearTimeout(pushStatusTimer.current);
          setPushStatus('Verification timed out, push not enabled');
          pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000);
        }, 2 * 60 * 1000);
        sendWebPushCode();
      } else {
        await LB.unsubscribeWebPush(userId);
        setWebPushSub(null);
        setPushEnabled(false);
        setWebPushVerified(false);
        try { localStorage.setItem('logbook-push-enabled', 'false'); localStorage.removeItem('logbook-push-verified'); } catch (_) {}
        setWebPushStep('idle'); setWebPushCode(''); setCodeInput('');
        setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: false } }));
      }
    } catch (e) {
      clearTimeout(pushStatusTimer.current);
      const msg = e.message?.toLowerCase() ?? '';
      setPushStatus(msg.includes('denied') || msg.includes('permission')
        ? 'Permission denied, enable notifications in browser settings'
        : `Error: ${e.message}`);
      pushStatusTimer.current = setTimeout(() => setPushStatus(null), 7000);
    } finally {
      setWebPushLoading(false);
    }
  };
  const sendWebPushCode = () => {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    setWebPushCode(code); setCodeInput(''); setWebPushStep('code-sent');
    LB.fnFetch(LB.WEB_PUSH_URL, { title: 'Zane · verification', message: `Your code: ${code}`, verify: true }).catch(() => {});
  };
  const verifyWebPushCode = () => {
    if (codeInput.trim() !== webPushCode) {
      clearTimeout(pushStatusTimer.current);
      setPushStatus('Wrong code, check the notification');
      pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000);
      return;
    }
    clearTimeout(pendingTimeoutRef.current);
    clearInterval(countdownIntervalRef.current);
    setPendingCountdown(120);
    setPushEnabled(true);
    setStore(s => ({ ...s, settings: { ...s.settings, pushEnabled: true } }));
    setWebPushVerified(true);
    try { localStorage.setItem('logbook-push-enabled', 'true'); localStorage.setItem('logbook-push-verified', 'true'); } catch (_) {}
    setWebPushPending(false);
    setWebPushStep('idle'); setWebPushCode(''); setCodeInput('');
    clearTimeout(pushStatusTimer.current);
    setPushStatus('✓ Verified'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 3000);
  };
  const PUSHOVER_VERIFY_URL = `${LB.SUPABASE_URL}/functions/v1/pushover-verify`;
  const closeAdvanced = () => { setAdvancedPushSheet(false); setPushoverStep('idle'); setPushKeyDraft(''); setCodeInput(''); setPendingCode(''); };
  const sendVerificationCode = async () => {
    setVerifyLoading(true);
    clearTimeout(pushStatusTimer.current);
    try {
      const res = await LB.fnFetch(PUSHOVER_VERIFY_URL, { userKey: pushKeyDraft.trim() });
      if (!res?.ok) { const d = await res?.json().catch(() => ({})); setPushStatus(`Error: ${d?.error || 'send failed'}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
      const { code } = await res.json();
      setPendingCode(code);
      setPushoverStep('code-sent');
    } catch (e) { setPushStatus(`Error: ${e.message}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); }
    finally { setVerifyLoading(false); }
  };
  const verifyCode = () => {
    if (codeInput.trim() !== pendingCode) { setPushStatus('Incorrect code, check the Pushover notification'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
    setStore(s => ({ ...s, settings: { ...s.settings, pushoverUserKey: pushKeyDraft.trim(), usePushover: true } }));
    setPushoverStep('idle'); setPendingCode(''); setCodeInput(''); setPushKeyDraft('');
    setPushStatus('✓ Pushover active'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 4000);
  };
  const disablePushover = () => {
    setStore(s => ({ ...s, settings: { ...s.settings, pushoverUserKey: null, usePushover: false } }));
    setPushoverStep('idle');
  };
  const testWebPush = async () => {
    clearTimeout(pushStatusTimer.current);
    setPushStatus('Sending…');
    try {
      const res = await LB.fnFetch(LB.WEB_PUSH_URL, { title: 'Zane Test', message: 'Notifications are working! 💪' });
      if (!res) { setPushStatus('Error: not signed in'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
      const data = await res.json().catch(() => ({}));
      if (res.status === 202 || data.scheduled) { setPushStatus('✓ Sent'); }
      else if (data.skipped) { setPushStatus('No subscription found, try toggling push off and on'); }
      else { setPushStatus(`Error: ${JSON.stringify(data)}`); }
    } catch (e) { setPushStatus(`Error: ${e.message}`); }
    pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000);
  };
  const testRestTimer = async (delaySeconds = 0) => {
    clearTimeout(pushStatusTimer.current);
    setPushStatus(delaySeconds > 0 ? 'Sending… Lock screen now!' : 'Sending…');
    const nonce = String(Date.now());
    const title = 'Zane Test';
    const message = 'Rest done, keep going! 💪';
    const usesPushover = !!(store.settings?.pushoverUserKey && store.settings?.usePushover);
    try {
      if (usesPushover) {
        const res = await LB.fnFetch(LB.PUSHOVER_URL, { message, title, delaySeconds, nonce, ttl: 10 });
        if (!res) { setPushStatus('Error: not signed in'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
        if (res.status === 202) { setPushStatus(`✓ Scheduled, notification in ~${delaySeconds}s`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), (delaySeconds + 15) * 1000); }
        else { const data = await res.json().catch(() => ({})); setPushStatus(data.skipped ? 'Key not synced yet, try again' : `Error: ${JSON.stringify(data)}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); }
      } else {
        const res = await LB.fnFetch(LB.WEB_PUSH_URL, { title, message, delaySeconds, nonce });
        if (!res) { setPushStatus('Error: not signed in'); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); return; }
        if (res.status === 202) { setPushStatus(`✓ Scheduled, notification in ~${delaySeconds}s`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), (delaySeconds + 15) * 1000); }
        else { const data = await res.json().catch(() => ({})); setPushStatus(`Error: ${JSON.stringify(data)}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); }
      }
    } catch (e) { setPushStatus(`Error: ${e.message}`); pushStatusTimer.current = setTimeout(() => setPushStatus(null), 5000); }
  };
  const toggleReminder = () => {
    const next = !reminderEnabled;
    if (next && !pushEnabled) {
      // Push not active, open push sheet instead of enabling reminder
      setTrainingSheet(false);
      setPushSheet(true);
      return;
    }
    setReminderEnabled(next);
    setStore(s => ({ ...s, settings: { ...s.settings, reminderEnabled: next } }));
  };
  const updateReminderTime = (val) => { setReminderTime(val); setStore(s => ({ ...s, settings: { ...s.settings, reminderTime: val } })); };
  const toggleDailyLogReminder = () => {
    const next = !dailyLogReminderEnabled;
    if (next && !pushEnabled) {
      // Push not active, open push sheet instead of enabling reminder
      setDailyLogReminderSheet(false);
      setPushSheet(true);
      return;
    }
    setDailyLogReminderEnabled(next);
    setStore(s => ({ ...s, settings: { ...s.settings, dailyLogReminderEnabled: next } }));
  };
  const updateDailyLogReminderTime = (val) => { setDailyLogReminderTime(val); setStore(s => ({ ...s, settings: { ...s.settings, dailyLogReminderTime: val } })); };
  const saveNickname = () => { const t = nickname.trim(); if (!t || t === store.user?.name) return; setStore(s => ({ ...s, user: { ...s.user, name: t } })); };
  // exportBackup throws on a partial fetch on purpose (an incomplete backup
  // silently wipes the missing rows on the next restore). That throw used to
  // land in an unhandled rejection here, so step 1 of the restore flow could
  // fail without a single visible sign while step 2 stayed armed.
  // Returns true only when a file actually reached the user.
  const exportData = async (filename) => {
    // A non-'synced' status means the store has edits the server doesn't
    // have yet (flushSync only retries on its own 15s timer, app.jsx), and
    // exportBackup refetches session entries/sets straight from the server,
    // overwriting the store's own (unsynced) copies with whatever's already
    // there (store.js:1008): exporting mid-failure would silently bake the
    // OLDER, already-synced version into the backup instead of the latest
    // edits, exactly the "Step 1" safety net the Restore flow's own copy
    // tells the user to rely on before the risky, destructive Step 2.
    if (syncStatus !== 'synced') {
      const proceed = await confirm(
        "You have changes that haven't finished syncing yet. A backup taken right now would save the older, already-synced version of that data instead of your latest edits. Wait a moment and try again, or export anyway?",
        { title: 'Unsynced changes', ok: 'Export anyway', cancel: 'Wait' },
      );
      if (!proceed) return false;
    }
    try {
      const backup = await LB.exportBackup(store, userId);
      const { blob, gz } = await LB.backupToBlob(backup);
      const base = filename || `zane-${LB.todayISO()}.json`;
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = gz ? `${base}.gz` : base; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBackupOk(true);
      return true;
    } catch (err) {
      setBackupOk(false);
      await confirm(`Could not create the backup: ${err?.message || 'Unknown error'}. Nothing was downloaded, so do not restore over this data yet.`, { title: 'Backup failed', ok: 'OK' });
      return false;
    }
  };
  // Shared by all three export formats: fetch + range-filter + flatten to one
  // row per session x exercise, sets as trailing columns ("100x10"). Only
  // completed, non-warmup, non-skipped sets count: a set the user never
  // actually did has nothing meaningful to put in the cell. mergeSpans
  // records, in `rows` index space, which runs of rows belong to the same
  // session (Date/Day blanked after the first row of a run, same as CSV used
  // to do standalone) so XLSX/PDF can turn that into a real merged/rowspanned
  // cell instead of the blank-repeat trick CSV has to fall back on.
  const buildTrainingExportRows = async () => {
    const today = LB.todayISO();
    const from = exportRange === '7' ? LB.shiftDate(today, -6)
      : exportRange === '30' ? LB.shiftDate(today, -29)
      : exportRange === 'custom' ? exportFrom
      : null; // 'all' -> no lower bound
    const to = exportRange === 'custom' ? exportTo : today;

    // s.date is a full timestamptz ("2026-07-29T10:00:00+00:00"), not a bare
    // date: sliced to the first 10 chars both for the range compare (else a
    // session with a non-midnight time sorts past a plain-date `to` bound
    // and silently drops off the end of its own day) and for display.
    const allSessions = await LB.fetchFullTrainingHistory(store, userId);
    const sessions = from ? allSessions.filter(s => (s.date || '').slice(0, 10) >= from && (s.date || '').slice(0, 10) <= to) : allSessions;

    // Purely data-driven off the set's own fields, not the exercise's
    // log_mode: covers weight+reps, reps-only, checkbox and time-based
    // exercises alike, and assisted/drop-set/myo-rep sets (kg can be
    // negative, or already the top-set number of a technique chain) fall
    // out of the same formula without special-casing each one.
    const formatSet = (st) => {
      if (st.timeSec != null) return `${st.timeSec}s`;
      const reps = (st.repsL != null || st.repsR != null) ? `${st.repsL ?? '-'}/${st.repsR ?? '-'}` : (st.reps ?? '');
      if (st.kg == null) return reps !== '' ? String(reps) : 'done';
      return `${st.kg}x${reps}`;
    };

    const rows = [];
    const mergeSpans = []; // [startIdx, endIdx] into `rows`, inclusive, for sessions spanning >1 row
    let maxSets = 0;
    let lastSessionId = null;
    let groupStart = -1;
    [...sessions]
      .sort((a, b) => `${a.date || ''}${a.startedAt || ''}`.localeCompare(`${b.date || ''}${b.startedAt || ''}`))
      .forEach(s => {
        (s.entries || []).forEach(en => {
          const cells = (en.sets || []).filter(st => st.done && !st.skipped && !st.warmup).map(formatSet);
          if (!cells.length) return;
          maxSets = Math.max(maxSets, cells.length);
          const isNewSession = s.id !== lastSessionId;
          if (isNewSession) {
            if (groupStart !== -1 && rows.length - 1 > groupStart) mergeSpans.push([groupStart, rows.length - 1]);
            groupStart = rows.length;
          }
          rows.push([isNewSession ? (s.date || '').slice(0, 10) : '', isNewSession ? (s.dayName || '') : '', en.name || '', ...cells]);
          lastSessionId = s.id;
        });
      });
    if (groupStart !== -1 && rows.length - 1 > groupStart) mergeSpans.push([groupStart, rows.length - 1]);

    const header = ['Date', 'Day', 'Exercise', ...Array.from({ length: maxSets }, (_, i) => `Set ${i + 1}`)];
    // Pad every row out to the full header width: XLSX/PDF both render one
    // cell per column, and a row with fewer sets than the widest session
    // would otherwise leave trailing cells missing entirely (not just empty)
    // in both, which drops their border/gridline instead of just looking blank.
    const paddedRows = rows.map(r => r.length < header.length ? [...r, ...Array(header.length - r.length).fill('')] : r);
    const suffix = exportRange === 'custom' ? `${exportFrom}-${exportTo}` : exportRange === 'all' ? 'all' : `${exportRange}d`;
    return { header, rows: paddedRows, mergeSpans, suffix };
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportTrainingCSV = ({ header, rows, suffix }) => {
    const esc = v => {
      if (v == null || v === '') return '';
      const s = String(v);
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
    // Leading BOM: without it, Excel guesses the system codepage instead of
    // UTF-8 and mangles any non-ASCII character in an exercise name.
    downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }), `training-history-${suffix}.csv`);
  };

  // ExcelJS, not SheetJS: SheetJS's free/community build parses cell styles
  // but silently drops them on write (confirmed by inspecting the raw
  // styles.xml it produces: no border/fill/alignment ever makes it in, even
  // with cellStyles:true), so borders and vertical centering were simply not
  // achievable with it. ExcelJS writes real styles in its open build.
  const exportTrainingXLSX = async ({ header, rows, mergeSpans, suffix }) => {
    const ExcelJS = await window.__ensureXLSX();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Training');
    ws.columns = [{ width: 12 }, { width: 10 }, { width: 26 }, ...header.slice(3).map(() => ({ width: 10 }))];

    const thinGray = { style: 'thin', color: { argb: 'FF999999' } };
    const border = { top: thinGray, bottom: thinGray, left: thinGray, right: thinGray };
    const accentArgb = 'FF' + (getComputedStyle(document.documentElement).getPropertyValue('--accent-raw').trim() || '#c9a961').replace('#', '').toUpperCase();

    const headerRow = ws.addRow(header);
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: accentArgb } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border = border;
    });
    // rows are already padded to header.length by buildTrainingExportRows,
    // so a plain eachCell (no includeEmpty) already reaches every column:
    // includeEmpty only walks a row's OWN cellCount, not the sheet's column
    // count, so a genuinely short row would otherwise leave trailing cells
    // (and their borders) missing entirely rather than just blank.
    rows.forEach(r => {
      const row = ws.addRow(r);
      row.eachCell(cell => {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        cell.border = border;
      });
    });

    // +2 on every row: ExcelJS is 1-indexed and row 1 is the header, so
    // `rows` index 0 is sheet row 2.
    mergeSpans.forEach(([s, e]) => {
      ws.mergeCells(s + 2, 1, e + 2, 1);
      ws.mergeCells(s + 2, 2, e + 2, 2);
    });

    // Filter dropdowns on the header row, the closest thing to Ctrl+T this
    // still gets you: a real Excel Table (ListObject, what Ctrl+T actually
    // creates) does not allow merged cells inside its range, and that would
    // mean giving up the Date/Day session merges above, so this stays a
    // plain styled range with autofilter rather than a Table.
    ws.autoFilter = { from: 'A1', to: { row: 1 + rows.length, column: header.length } };

    const buf = await wb.xlsx.writeBuffer();
    downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `training-history-${suffix}.xlsx`);
  };

  const exportTrainingPDF = ({ header, rows, mergeSpans }) => {
    const escHtml = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Mirror of the XLSX merges, expressed as native <td rowspan> instead:
    // the span's first row carries the rowspan, every other row in the span
    // just omits the Date/Day <td>s entirely (standard HTML table merge).
    const rowSpanAt = new Map(mergeSpans.map(([s, e]) => [s, e - s + 1]));
    const mergedAway = new Set(mergeSpans.flatMap(([s, e]) => Array.from({ length: e - s }, (_, i) => s + i + 1)));
    // Zebra striping is applied per <td> here, not via a `tr:nth-child`
    // background rule: a rowspan cell has no background of its own, so a
    // row-level stripe painted on the <tr> it visually overlaps shows
    // through it, and the merged Date/Day cell ends up striped internally
    // instead of reading as one solid block. Explicit white on Date/Day
    // sidesteps that entirely, regardless of what the row underneath does.
    const bodyRows = rows.map((r, i) => {
      const stripe = i % 2 === 1 ? ' style="background:#f7f7f7"' : '';
      const restCells = r.slice(2).map(c => `<td${stripe}>${escHtml(c)}</td>`).join('');
      if (mergedAway.has(i)) return `<tr>${restCells}</tr>`;
      const span = rowSpanAt.get(i) || 1;
      const spanAttr = span > 1 ? ` rowspan="${span}"` : '';
      return `<tr><td${spanAttr} style="background:#fff">${escHtml(r[0])}</td><td${spanAttr} style="background:#fff">${escHtml(r[1])}</td>${restCells}</tr>`;
    }).join('');
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-raw').trim() || '#c9a961';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Training Export</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
        @page{margin:12mm}
        body{font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#1a1a1a}
        table{border-collapse:collapse;width:100%;font-size:11px;border:1px solid #999}
        th,td{border:1px solid #999;padding:5px 8px;text-align:left;vertical-align:top}
        th{background:${accent};color:#fff;text-transform:uppercase;letter-spacing:0.04em;font-size:9px}
      </style>
    </head><body>
      <div style="padding:8px 0 14px;text-align:center;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase">Training Export</div>
      <table><thead><tr>${header.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead><tbody>${bodyRows}</tbody></table>
      <script>
        var isIOS=/iPhone|iPad|iPod/.test(navigator.userAgent)&&!window.MSStream;
        if(!isIOS){window.onload=function(){window.print()};}
      <\/script>
    </body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const doExportTraining = async () => {
    setExportingTraining(true);
    try {
      const built = await buildTrainingExportRows();
      if (!built.rows.length) {
        await confirm('No completed training sets found in this range.', { title: 'Nothing to export', ok: 'OK' });
        return;
      }
      if (exportFormat === 'csv') exportTrainingCSV(built);
      else if (exportFormat === 'xlsx') await exportTrainingXLSX(built);
      else exportTrainingPDF(built);
      setTrainingExportSheet(false);
    } catch (err) {
      await confirm(`Could not export training history: ${err?.message || 'Unknown error'}`, { title: 'Export failed', ok: 'OK' });
    } finally {
      setExportingTraining(false);
    }
  };
  const runImport = () => {
    // input.click() must be synchronous in the user-gesture handler (iOS Safari).
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,.gz,application/json,application/gzip';
    input.onchange = async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      let backup;
      try { backup = JSON.parse(await LB.readBackupText(file)); }
      catch (e) { await confirm(/compress/i.test(e?.message || '') ? e.message : 'The selected file is not valid JSON.', { title: 'Invalid file', ok: 'OK' }); return; }
      const invalid = LB.validateBackup(backup);
      if (invalid) { await confirm(invalid, { title: 'Invalid backup', ok: 'OK' }); return; }

      // Auto-detect source unit from backup; update toggle + ref so the user sees it.
      // Normalized to the weight axis, so a 'mixed' backup detects as kg.
      const detectedUnit = backup.settings?.unit;
      if (detectedUnit === 'kg' || detectedUnit === 'lbs' || detectedUnit === 'mixed') setImportSourceUnit(LB.weightAxisUnit(detectedUnit));

      const latestSession = [...(backup.sessions || [])].filter(s => s.ended).sort((a, b) => (b.ended || '').localeCompare(a.ended || ''))[0];
      const backupDate = latestSession ? new Date(latestSession.ended).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : 'unknown date';
      // Compare the WEIGHT axis, not the raw setting: 'mixed' means kg weight,
      // so a mixed user importing a kg backup must not convert anything.
      const userUnit = store.settings?.unit || 'kg';
      const userAxis = LB.weightAxisUnit(userUnit);
      const srcAxis = LB.weightAxisUnit(importSourceUnitRef.current);
      const unitMismatch = srcAxis !== userAxis;
      const unitNote = unitMismatch ? ` Weights will be converted from ${srcAxis.toUpperCase()} to ${userAxis.toUpperCase()}.` : '';
      const ok = await confirm(`This backup contains data up to ${backupDate}. Your current data will be permanently replaced.${unitNote}`, { title: 'Replace data?', ok: 'Replace', danger: true });
      if (!ok) return;
      // targetUnit stays the real setting ('mixed' keeps its mi distances).
      const unitConvert = unitMismatch
        ? { multiplier: srcAxis === 'kg' ? 2.20462 : 1 / 2.20462, targetUnit: userUnit }
        : null;
      setImporting(true);
      setImportProgress({ pct: 0, phase: 'Starting…' });
      try {
        await LB.importFromBackup(backup, userId, (pct, phase) => setImportProgress({ pct, phase }), unitConvert);
        LB.clearLocal(userId); window.location.reload();
      }
      catch (err) { setImporting(false); await confirm(`Import failed: ${err.message || 'Unknown error'}`, { title: 'Error', ok: 'OK' }); }
    }; input.click();
  };
  const readMigrationFile = async (file, mode = 'plan') => {
    if (!/\.xlsx$/i.test(file.name || '')) return file.text();
    if (typeof window.__ensureXLSX !== 'function') throw new Error('XLSX support could not be loaded. Connect once and try again.');
    const ExcelJS = await window.__ensureXLSX();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const csvCell = (cell) => {
      let value = cell?.text;
      if (value == null || value === '') {
        const raw = cell?.value;
        if (raw && typeof raw === 'object') {
          if (Array.isArray(raw.richText)) value = raw.richText.map(part => part?.text || '').join('');
          else if (raw.result != null) value = raw.result;
          else if (raw.text != null) value = raw.text;
          else if (raw.hyperlink != null) value = raw.hyperlink;
        } else value = raw;
      }
      const text = value == null ? '' : String(value);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const normalizeHeader = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
    const worksheetRows = worksheet => {
      const columnCount = Math.max(worksheet.actualColumnCount || 0, worksheet.columnCount || 0);
      const rows = [];
      worksheet.eachRow({ includeEmpty: false }, row => {
        rows.push(Array.from({ length: columnCount }, (_, index) => csvCell(row.getCell(index + 1))).join(','));
      });
      return rows;
    };
    const scoreWorksheet = worksheet => {
      const sample = [];
      let rowCount = 0;
      worksheet.eachRow({ includeEmpty: false }, row => {
        rowCount += 1;
        if (sample.length < 40) sample.push(Array.from({ length: Math.max(worksheet.actualColumnCount || 0, worksheet.columnCount || 0) }, (_, index) => String(csvCell(row.getCell(index + 1))).replace(/^"|"$/g, '')));
      });
      const values = sample.flat().map(normalizeHeader);
      const hasExercise = values.some(value => /^(exercise|exercise name|movement|movement name|lift|lift name)$/.test(value));
      const hasDate = values.some(value => /(^| )(date|workout date|session date|performed|logged|training date|started|start|timestamp|epoch|unix)( |$)/.test(value));
      const requiredScore = mode === 'history' ? (hasExercise && hasDate ? 60 : 0) : (hasExercise ? 40 : 0);
      return { worksheet, rowCount, score: requiredScore + Math.min(rowCount, 200) / 200 };
    };
    const candidates = (workbook.worksheets || []).map(scoreWorksheet).filter(candidate => candidate.rowCount > 0);
    const selected = candidates.sort((a, b) => b.score - a.score || b.rowCount - a.rowCount)[0];
    if (!selected) throw new Error('The XLSX file does not contain a worksheet with rows.');
    const rows = worksheetRows(selected.worksheet);
    if (!rows.length) throw new Error('The XLSX file does not contain any rows.');
    return rows.join('\n');
  };
  const runWorkoutImport = () => {
    // Keep input.click synchronous for iOS Safari. CSV and XLSX are parsed
    // locally; only a bounded sample is sent to Qwen/Claude for mapping.
    setMigrationSheet(false);
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    input.onchange = async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      setDataSheet(false); setWorkoutImportSheet(true); setWorkoutImportPreview(null); setWorkoutImportError(null); setWorkoutImportStep(1); setWorkoutImportPreviewIndex(0); setWorkoutImportProgress({ pct: 3, phase: 'Reading the file…' }); setWorkoutImportLoading(true);
      try {
        if (file.size > 4_000_000) throw new Error('This CSV or XLSX is larger than 4 MB. Export a smaller date range and import it in two batches.');
        const text = await readMigrationFile(file, 'history');
        setWorkoutImportProgress({ pct: 12, phase: 'Reading the file complete. Preparing the mapping…' });
        const preview = await LB.previewWorkoutImport(text, userId, LB.weightAxisUnit(store.settings?.unit), store.exercises || [], progress => setWorkoutImportProgress(progress));
        setWorkoutImportPreview(preview); setWorkoutImportStep(1); setWorkoutImportPreviewIndex(0);
      } catch (err) {
        setWorkoutImportError(err?.message || 'Could not read this CSV or XLSX file.');
      } finally { setWorkoutImportLoading(false); }
    };
    input.click();
  };
  const closePlanImport = () => {
    setPlanImportSheet(false);
    setPlanImportPreview(null);
    setPlanImportError(null);
    setPlanImportProgress({ pct: 0, phase: '' });
    setPlanImportStep(1);
    setPlanImportDayIndex(0);
  };
  const runPlanImport = () => {
    // Keep input.click synchronous for iOS Safari, just like the history
    // importer. The browser sends only a bounded sample to the AI mapper.
    setMigrationSheet(false);
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    input.onchange = async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      setPlanImportSheet(true); setPlanImportPreview(null); setPlanImportError(null); setPlanImportStep(1); setPlanImportDayIndex(0); setPlanImportProgress({ pct: 3, phase: 'Reading the plan…' }); setPlanImportLoading(true);
      try {
        if (file.size > 4_000_000) throw new Error('This CSV or XLSX is larger than 4 MB. Export a smaller plan and try again.');
        const text = await readMigrationFile(file, 'plan');
        const preview = await LB.previewWorkoutPlanImport(text, userId, LB.weightAxisUnit(store.settings?.unit), store.exercises || [], file.name);
        setPlanImportPreview(preview); setPlanImportStep(1); setPlanImportDayIndex(0);
      } catch (err) {
        setPlanImportError(err?.message || 'Could not read this plan CSV or XLSX file.');
      } finally { setPlanImportLoading(false); }
    };
    input.click();
  };
  const commitWorkoutImport = async () => {
    if (!workoutImportPreview || workoutImportSaving) return;
    setWorkoutImportSaving(true); setWorkoutImportError(null); setWorkoutImportProgress({ pct: 2, phase: 'Preparing the selected workouts…' });
    try {
      await LB.commitWorkoutImport(workoutImportPreview, userId, {
        duplicateMode: workoutImportDuplicateMode,
        unknownMode: workoutImportUnknownMode,
        existingExercises: store.exercises || [],
        onProgress: progress => setWorkoutImportProgress(progress),
      });
      // Direct import writes bypass the normal in-memory diff. Rebooting after
      // the commit gives the user the same authoritative server view as any
      // other large restore, and the deterministic batch ids make a retry safe.
      LB.clearLocal(userId); window.location.reload();
    } catch (err) {
      setWorkoutImportError(`The workout import stopped part-way through: ${err?.message || 'unknown error'}. You can retry this preview safely; already written rows use the same import IDs.`);
      setWorkoutImportSaving(false);
    }
  };
  const commitPlanImport = async () => {
    if (!planImportPreview || planImportSaving) return;
    setPlanImportSaving(true); setPlanImportError(null); setPlanImportProgress({ pct: 2, phase: 'Preparing the imported plan…' });
    try {
      await LB.commitWorkoutPlanImport(planImportPreview, userId, { existingExercises: store.exercises || [], onProgress: progress => setPlanImportProgress(progress) });
      // Direct schedule/exercise writes bypass the normal in-memory diff. A
      // fresh load gives the user the same authoritative view as any restore.
      LB.clearLocal(userId); window.location.reload();
    } catch (err) {
      setPlanImportError(`The plan import stopped before completion: ${err?.message || 'unknown error'}. You can retry this preview safely.`);
      setPlanImportSaving(false);
    }
  };
  // Flush BEFORE arming the latch: markIntentionalSignOut() is what allows
  // SIGNED_OUT to run LB.clearLocal, which drops the local cache, the pending
  // diff and syncBase in one go. If the final sync did not land (slow network,
  // failed write), that cache is the only copy left of the last sets / cycle
  // advance / day macros, so arming it would delete them for good. Sign out
  // UNARMED instead: the involuntary path keeps the cache and the next sign-in
  // on this device re-uploads the diff. Asked, not silent, because the user
  // then stays "not fully synced" and should know why.
  const handleSignOut = async () => {
    const flushed = await flushBeforeSignOut(userId);
    if (!flushed) {
      const ok = await confirm(
        'Some changes could not be saved to the server. They stay on this device and are uploaded the next time you sign in here.',
        { title: 'Sign out anyway?', ok: 'Sign out anyway', danger: true }
      );
      if (!ok) return;
      // Check the result before acting on it. The most common reason the flush
      // failed is being offline, and offline signOut returns { error } BEFORE
      // it removes the session, so nothing is signed out and no SIGNED_OUT
      // fires. Reloading regardless booted straight back into the signed-in
      // app: the user confirmed a red dialog and the only visible effect was
      // losing their place. Say so instead.
      const { error: signOutErr } = (await LB.signOut()) || {};
      if (signOutErr) {
        await confirm(
          'Signing out needs a connection, and there is none right now. Your data is safe on this device. Try again once you are back online.',
          { title: "Couldn't sign out", ok: 'OK', cancel: null }
        );
        return;
      }
      // Reload so the user actually lands on the login screen: the involuntary
      // SIGNED_OUT path deliberately leaves the app on screen (it also covers
      // a flaky refresh while you keep training), which after a tapped sign-out
      // would look like nothing happened. The cache stays untouched by it.
      window.location.reload();
      return;
    }
    markIntentionalSignOut();
    await LB.signOut();
  };

  const attachSupportImageFile = (file) => {
    if (!file) return;
    setSupportImageFile(file);
    const reader = new FileReader();
    reader.onload = ev => setSupportImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  };
  const handleImagePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    attachSupportImageFile(file);
  };
  // Paste an image straight from the clipboard (screenshot, copied photo…)
  // into the message box, same as picking a file.
  const onPasteSupportMessage = (e) => {
    const item = Array.from(e.clipboardData?.items || []).find(it => it.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    attachSupportImageFile(item.getAsFile());
  };

  const attachAdminImageFile = (file) => {
    if (!file) return;
    setAdminImageFile(file);
    const reader = new FileReader();
    reader.onload = ev => setAdminImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  };
  const handleAdminImagePick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    attachAdminImageFile(file);
  };
  const onPasteAdminMessage = (e) => {
    const item = Array.from(e.clipboardData?.items || []).find(it => it.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    attachAdminImageFile(item.getAsFile());
  };

  const handleSupportSend = async () => {
    if ((!supportDraft.trim() && !supportImageFile) || supportSending || !supportActiveTicketId) return;
    setSupportSending(true);
    const body = supportDraft.trim();
    const imgFile = supportImageFile;
    const imgPreview = supportImagePreview;
    setSupportDraft('');
    setSupportImageFile(null);
    setSupportImagePreview(null);
    // Restore the typed message + image on failure so a swallowed write (network
    // / RLS) can't silently drop the user's message while looking sent (audit B2).
    const restore = () => { setSupportDraft(body); setSupportImageFile(imgFile); setSupportImagePreview(imgPreview); };
    try {
      let attachments = null;
      if (imgFile) {
        const url = await LB.uploadChatImage(imgFile, userId);
        attachments = [{ url, name: imgFile.name, type: imgFile.type }];
      }
      const { data: note, error } = await LB.supabase.from('zane_coaching_notes').insert({
        id: LB.uid(), coaching_id: supportActiveTicketId, author_id: userId, type: 'general',
        body: body || '', ...(attachments ? { attachments } : {}),
      }).select('id, author_id, body, created_at, read_at, edited_at, attachments').single();
      if (error || !note) { restore(); UI.alert('Message failed to send. Please try again.'); return; }
      setSupportActiveNotes(prev => [...prev, note]);
      const preview = attachments ? (body || '📷 Image') : body;
      setStore(s => ({ ...s, supportTickets: (s.supportTickets || []).map(t =>
        t.coachingId === supportActiveTicketId
          ? { ...t, lastMessageAt: note.created_at, lastMessageBody: preview }
          : t
      )}));
      LB.fnFetch(`${LB.SUPABASE_URL}/functions/v1/zane_coaching-notify`, { coachingId: supportActiveTicketId, preview });
    } catch (e) { restore(); UI.alert(e.message || 'Message failed to send. Please try again.'); }
    finally { setSupportSending(false); }
  };

  const handleCreateTicket = async () => {
    if ((!supportDraft.trim() && !supportImageFile) || supportSending) return;
    setSupportSending(true);
    const body = supportDraft.trim();
    const imgFile = supportImageFile;
    const imgPreview = supportImagePreview;
    setSupportDraft('');
    setSupportImageFile(null);
    setSupportImagePreview(null);
    // Restore the typed message + image on failure so it isn't silently lost
    // (audit B4). A ticket created without a first message stays hidden from the
    // admin inbox until the user retries (get_support_chats excludes it).
    const restore = () => { setSupportDraft(body); setSupportImageFile(imgFile); setSupportImagePreview(imgPreview); };
    try {
      const { data: coachingId, error: ticketErr } = await LB.supabase.rpc('open_support_chat', { p_category: supportCategoryDraft });
      if (ticketErr || !coachingId) { restore(); UI.alert('Could not open the ticket. Please try again.'); return; }
      let attachments = null;
      if (imgFile) {
        const url = await LB.uploadChatImage(imgFile, userId);
        attachments = [{ url, name: imgFile.name, type: imgFile.type }];
      }
      const { data: note, error: noteErr } = await LB.supabase.from('zane_coaching_notes').insert({
        id: LB.uid(), coaching_id: coachingId, author_id: userId, type: 'general',
        body: body || '', ...(attachments ? { attachments } : {}),
      }).select('id, author_id, body, created_at, read_at, edited_at, attachments').single();
      if (noteErr || !note) { restore(); UI.alert('Message failed to send. Please try again.'); return; }
      {
        const preview = attachments ? (body || '📷 Image') : body;
        const newTicket = {
          coachingId, status: 'open', category: supportCategoryDraft,
          createdAt: new Date().toISOString(), lastMessageAt: note.created_at,
          lastMessageBody: preview, unreadCount: 0,
        };
        setStore(s => ({ ...s, supportTickets: [newTicket, ...(s.supportTickets || [])] }));
        setSupportCategoryDraft('question');
        setSupportActiveTicketId(coachingId);
        setSupportActiveNotes([note]);
        setSupportView('thread');
        LB.fnFetch(`${LB.SUPABASE_URL}/functions/v1/zane_coaching-notify`, { coachingId, preview });
      }
    } catch (e) { restore(); UI.alert(e.message || 'Could not create the ticket. Please try again.'); }
    finally { setSupportSending(false); }
  };

  const handleAdminReply = async () => {
    if ((!supportAdminDraft.trim() && !adminImageFile) || supportAdminSending || !supportTicket) return;
    setSupportAdminSending(true);
    const body = supportAdminDraft.trim();
    const imgFile = adminImageFile;
    const imgPreview = adminImagePreview;
    setSupportAdminDraft('');
    setAdminImageFile(null);
    setAdminImagePreview(null);
    // Restore the reply on failure so a swallowed write can't silently drop the
    // admin's message while looking sent (audit B5).
    const restore = () => { setSupportAdminDraft(body); setAdminImageFile(imgFile); setAdminImagePreview(imgPreview); };
    try {
      let attachments = null;
      if (imgFile) {
        const url = await LB.uploadChatImage(imgFile, userId);
        attachments = [{ url, name: imgFile.name, type: imgFile.type }];
      }
      const { data: note, error } = await LB.supabase.from('zane_coaching_notes').insert({
        id: LB.uid(), coaching_id: supportTicket.coachingId, author_id: userId, type: 'general',
        body: body || '', ...(attachments ? { attachments } : {}),
      }).select('id, author_id, body, created_at, read_at, edited_at, attachments').single();
      if (error || !note) { restore(); UI.alert('Reply failed to send. Please try again.'); return; }
      setSupportTicketNotes(prev => [...prev, note]);
      const preview = attachments ? (body || '📷 Image') : body;
      LB.fnFetch(`${LB.SUPABASE_URL}/functions/v1/zane_coaching-notify`, { coachingId: supportTicket.coachingId, preview });
    } catch (e) { restore(); UI.alert(e.message || 'Reply failed to send. Please try again.'); }
    finally { setSupportAdminSending(false); }
  };

  const canModifySupportNote = note => {
    const createdAt = Date.parse(note?.created_at || '');
    return Number.isFinite(createdAt) && Date.now() - createdAt <= 60 * 60 * 1000;
  };

  const supportNoteWindowError = 'Messages can only be edited or deleted within 60 minutes of sending.';

  const beginSupportEdit = async note => {
    if (!canModifySupportNote(note)) {
      await confirm(supportNoteWindowError, { title: 'Message window expired', ok: 'OK' });
      return;
    }
    setSupportEditingNoteId(note.id);
    setSupportEditingBody(note.body || '');
  };

  const cancelSupportEdit = () => {
    setSupportEditingNoteId(null);
    setSupportEditingBody('');
  };

  const saveSupportEdit = async note => {
    if (supportNoteActionBusy || !supportEditingBody.trim()) return;
    if (!canModifySupportNote(note)) {
      await confirm(supportNoteWindowError, { title: 'Message window expired', ok: 'OK' });
      cancelSupportEdit();
      return;
    }
    setSupportNoteActionBusy(true);
    try {
      const updated = await LB.updateCoachingNote(note.id, userId, supportEditingBody);
      const patchNote = { body: updated.body, edited_at: updated.editedAt };
      setSupportActiveNotes(prev => prev.map(item => item.id === note.id ? { ...item, ...patchNote } : item));
      setSupportTicketNotes(prev => prev.map(item => item.id === note.id ? { ...item, ...patchNote } : item));
      cancelSupportEdit();
    } catch (e) {
      UI.alert(e.message || 'Could not edit message');
    } finally {
      setSupportNoteActionBusy(false);
    }
  };

  const removeSupportNote = async note => {
    if (supportNoteActionBusy) return;
    if (!canModifySupportNote(note)) {
      await confirm(supportNoteWindowError, { title: 'Message window expired', ok: 'OK' });
      return;
    }
    if (!await confirm('Delete this message?', { title: 'Delete message', ok: 'Delete', danger: true })) return;
    setSupportNoteActionBusy(true);
    try {
      await LB.deleteCoachingNote(note.id, userId);
      setSupportActiveNotes(prev => prev.filter(item => item.id !== note.id));
      setSupportTicketNotes(prev => prev.filter(item => item.id !== note.id));
      if (supportEditingNoteId === note.id) cancelSupportEdit();
    } catch (e) {
      UI.alert(e.message || 'Could not delete message');
    } finally {
      setSupportNoteActionBusy(false);
    }
  };

  const sendBroadcast = async () => {
    const body = broadcastBody.trim();
    if (!body || broadcastSending) return;
    setBroadcastSending(true);
    setBroadcastMsg(null);
    try {
      const { data, error } = await LB.supabase.rpc('admin_broadcast_message', { p_body: body });
      if (error) { setBroadcastMsg({ ok: false, text: error.message }); return; }
      setBroadcastMsg({ ok: true, text: `Sent to ${data} user${data === 1 ? '' : 's'}.` });
      setBroadcastBody('');
    } finally { setBroadcastSending(false); }
  };

  // Pushes the "New version available" banner to every connected client
  // without needing an sw.js cache-version bump, see admin_force_update.
  const handleForceUpdateAll = async () => {
    if (!await confirm('Every connected user will see the update banner and be prompted to refresh.', { title: 'Force refresh all users?', ok: 'Send' })) return;
    const { error } = await LB.supabase.rpc('admin_force_update');
    if (!error) {
      // The broadcast has no per-user exclusion, without this, the device
      // that sent it would see its own banner too. Mark the freshly-set nonce
      // as already seen on THIS device before checkForceUpdate ever polls it.
      const config = await LB.fetchRuntimeConfig().catch(() => null);
      const nonce = config?.forceUpdateNonce;
      if (nonce) { try { localStorage.setItem('logbook-force-nonce-seen', nonce); } catch (_) {} }
    }
    await confirm(error ? (error.message || 'Could not trigger the broadcast.') : 'All connected clients will see the update banner shortly.', { title: error ? 'Error' : 'Sent', ok: 'OK' });
  };

  const setSocialMode = async mode => {
    if (socialModeBusy || !['normal', 'maintenance'].includes(mode)) return;
    if (mode === 'maintenance' && !await confirm('Friends will stop querying immediately. Login, training and sync stay available.', { title: 'Pause Friends?', ok: 'Pause' })) return;
    setSocialModeBusy(true);
    setDbStabilityMsg(null);
    try {
      const { error } = await LB.supabase.rpc('admin_set_social_mode', { p_mode: mode });
      if (error) throw error;
      await LB.fetchRuntimeConfig();
      setDbStabilityMsg({ ok: true, text: mode === 'maintenance' ? 'Friends is now paused.' : 'Friends is back in normal mode.' });
    } catch (error) {
      setDbStabilityMsg({ ok: false, text: error.message || 'Could not change social mode.' });
    } finally { setSocialModeBusy(false); }
  };

  const setSocialTransport = async transport => {
    if (socialTransportBusy || !['legacy', 'broadcast'].includes(transport)) return;
    if (transport === 'legacy' && !await confirm('All Friends users will switch back to Postgres Changes within two minutes. Use this only as a Broadcast rollback.', { title: 'Use legacy Realtime?', ok: 'Switch' })) return;
    setSocialTransportBusy(true);
    setDbStabilityMsg(null);
    try {
      const { error } = await LB.supabase.rpc('admin_set_social_transport', { p_transport: transport });
      if (error) throw error;
      await LB.fetchRuntimeConfig();
      setDbStabilityMsg({ ok: true, text: transport === 'broadcast' ? 'All current and future Friends users now use Broadcast.' : 'All Friends users now use legacy Realtime.' });
    } catch (error) {
      setDbStabilityMsg({ ok: false, text: error.message || 'Could not change the Social transport.' });
    } finally { setSocialTransportBusy(false); }
  };

  const setCoachingTransport = async transport => {
    if (coachingTransportBusy || !['legacy', 'broadcast'].includes(transport)) return;
    if (transport === 'legacy' && !await confirm('Coaching, support and coach-status updates will switch back to Postgres Changes within two minutes. The rollback publication is restored first.', { title: 'Use legacy Coaching?', ok: 'Switch' })) return;
    setCoachingTransportBusy(true);
    setDbStabilityMsg(null);
    try {
      const { error } = await LB.supabase.rpc('admin_set_coaching_transport', { p_transport: transport });
      if (error) throw error;
      await LB.fetchRuntimeConfig();
      setDbStabilityMsg({ ok: true, text: transport === 'broadcast' ? 'All current and future users now receive Coaching updates through Broadcast.' : 'Coaching now uses legacy Realtime.' });
    } catch (error) {
      setDbStabilityMsg({ ok: false, text: error.message || 'Could not change the Coaching transport.' });
    } finally { setCoachingTransportBusy(false); }
  };

  const sendAdminEmail = async () => {
    const subject = adminEmailSubject.trim();
    const body = adminEmailBody.trim();
    if (!subject || !body || adminEmailSending || !adminUserDetail?.email) return;
    setAdminEmailSending(true);
    setAdminEmailMsg(null);
    try {
      const res = await LB.adminSendEmail(adminUserDetail.email, subject, body);
      if (!res.ok) { setAdminEmailMsg({ ok: false, text: res.error }); return; }
      setAdminEmailMsg({ ok: true, text: `Sent to ${adminUserDetail.email}.` });
      setAdminEmailSubject('');
      setAdminEmailBody('');
    } finally { setAdminEmailSending(false); }
  };

  const saveVipBg = async () => {
    const email = vipBgEmail.trim().toLowerCase();
    if (!email || vipBgSaving) return;
    setVipBgSaving(true);
    setVipBgMsg(null);
    try {
      const { data, error } = await LB.supabase.rpc('set_user_vip_background', { p_email: email, p_bg_key: vipBgKey });
      if (error) { setVipBgMsg({ ok: false, text: error.message }); return; }
      if (data === 'ERROR:not_found') { setVipBgMsg({ ok: false, text: `No account found for ${email}` }); return; }
      setVipBgMsg({ ok: true, text: vipBgKey ? `Background set for ${email}` : `Background cleared for ${email}` });
      setVipBgEmail('');
      setVipBgKey('');
      LB.supabase.rpc('get_user_vip_backgrounds').then(({ data: list }) => { setVipBgList(list || []); }).catch(() => {});
    } finally { setVipBgSaving(false); }
  };

  const handleSetSupportStatus = async (coachingId, newStatus) => {
    const { error } = await LB.supabase.rpc('set_support_status', { p_coaching_id: coachingId, p_status: newStatus });
    if (error) { console.error(error); return; }
    setSupportInbox(prev => prev.map(t => t.coaching_id === coachingId ? { ...t, support_status: newStatus } : t));
    setSupportTicket(t => t ? { ...t, status: newStatus } : t);
    setStore(s => ({ ...s, supportTickets: (s.supportTickets || []).map(t =>
      t.coachingId === coachingId ? { ...t, status: newStatus } : t
    )}));
  };

  const handleArchiveTicket = async () => {
    if (!supportTicket) return;
    const coachingId = supportTicket.coachingId;
    const { error } = await LB.supabase.rpc('archive_support_ticket', { p_coaching_id: coachingId });
    if (error) { UI.alert('Could not archive the ticket: ' + error.message); return; }
    setSupportInbox(prev => prev.filter(t => t.coaching_id !== coachingId));
    setSupportTicket(null);
    setSupportAdminDraft('');
  };

  const [deletingTicket, setDeletingTicket] = useStateSet(false);
  const [confirmDeleteTicket, setConfirmDeleteTicket] = useStateSet(false);

  const handleDeleteTicket = async () => {
    if (!supportTicket) return;
    const coachingId = supportTicket.coachingId;
    setDeletingTicket(true);
    try {
      // Notify user BEFORE deleting (coaching row must still exist)
      const { data: { session } } = await LB.supabase.auth.getSession();
      if (session?.access_token) {
        await fetch(`${LB.SUPABASE_URL}/functions/v1/zane_coaching-notify`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ coachingId, preview: 'Your support ticket has been removed by support.' }),
        }).catch(() => {});
      }
      // Delete storage attachments for all notes in this ticket
      const { data: notesWithAttachments } = await LB.supabase
        .from('zane_coaching_notes')
        .select('attachments')
        .eq('coaching_id', coachingId)
        .not('attachments', 'is', null);
      const storagePrefix = `${LB.SUPABASE_URL}/storage/v1/object/public/chat-attachments/`;
      const paths = (notesWithAttachments || []).flatMap(n =>
        (n.attachments || []).map(a => a.url?.startsWith(storagePrefix) ? a.url.slice(storagePrefix.length) : null).filter(Boolean)
      );
      // Delete the ticket rows first and only purge storage attachments once
      // that succeeded, so a failed delete can't orphan a ticket whose
      // attachments are already gone.
      const { error: delErr } = await LB.supabase.rpc('delete_support_ticket', { p_coaching_id: coachingId });
      if (delErr) { UI.alert('Could not delete the ticket: ' + delErr.message); return; }
      if (paths.length > 0) {
        await LB.supabase.storage.from('chat-attachments').remove(paths).catch(() => {});
      }
      setSupportInbox(prev => prev.filter(t => t.coaching_id !== coachingId));
      setSupportTicket(null);
      setSupportAdminDraft('');
      setConfirmDeleteTicket(false);
    } finally {
      setDeletingTicket(false);
    }
  };

  const handleChangePassword = async () => {
    if (pwLoading) return;
    if (pwNew.length < 6) { setPwMsg({ text: 'Password must be at least 6 characters', ok: false }); return; }
    if (pwNew !== pwConfirm) return;
    setPwLoading(true); setPwMsg(null);
    try {
      const { error: signInErr } = await LB.supabase.auth.signInWithPassword({ email: store.user?.email || '', password: pwCurrent });
      if (signInErr) {
        // A network drop here must not masquerade as a wrong password.
        const isNet = /load failed|failed to fetch|networkerror|network request failed/i.test(signInErr.message || '');
        setPwMsg({ text: isNet ? UI.authErrorMessage(signInErr) : 'Current password is incorrect', ok: false });
        return;
      }
      const { error: updateErr } = await LB.supabase.auth.updateUser({ password: pwNew });
      if (updateErr) { setPwMsg({ text: UI.authErrorMessage(updateErr, 'Failed to update password'), ok: false }); }
      else { setPwMsg({ text: 'Password updated successfully', ok: true }); setPwCurrent(''); setPwNew(''); setPwConfirm(''); }
    } catch (e) {
      setPwMsg({ text: UI.authErrorMessage(e, 'Something went wrong'), ok: false });
    } finally {
      setPwLoading(false);
    }
  };

  const handleChangeEmail = async () => {
    if (emailLoading) return;
    const trimmed = emailNew.trim().toLowerCase();
    if (!trimmed.includes('@') || !trimmed.includes('.')) { setEmailMsg({ text: 'Please enter a valid email address', ok: false }); return; }
    if (trimmed === (store.user?.email || '').toLowerCase()) { setEmailMsg({ text: 'This is already your current email address', ok: false }); return; }
    setEmailLoading(true); setEmailMsg(null);
    try {
      const { error } = await LB.supabase.auth.updateUser({ email: trimmed });
      if (error) { setEmailMsg({ text: error.message || 'Failed to update email', ok: false }); }
      else { setEmailMsg({ text: `Confirmation link sent to ${trimmed}, click the link in your new inbox to complete the change`, ok: true }); }
    } catch (e) {
      setEmailMsg({ text: e.message || 'Something went wrong', ok: false });
    } finally {
      setEmailLoading(false);
    }
  };

  const handleDeleteAll = async () => {
    const email = store.user?.email || 'this account';
    const ok = await confirm(
      <>This permanently erases every workout, plan and log for <b style={{ color: UI.ink }}>{email}</b>, then signs you out. It cannot be undone.</>,
      { title: 'Delete all data?', ok: 'Delete all', danger: true, requireText: 'Delete my data' }
    );
    if (!ok) return;
    // deleteAllData can throw halfway through (network drop, RLS). Arming the
    // sign-out latch before it and letting the rejection escape left the
    // account partly deleted, the user on the raw crash overlay, and the latch
    // stuck on for the rest of the page session (which makes the next
    // involuntary SIGNED_OUT wipe the pending local diff). Arm it only right
    // before the sign-out that it describes, and report a failure.
    try {
      await LB.deleteAllData(userId);
    } catch (err) {
      await confirm(`Deleting your data failed partway through: ${err?.message || 'Unknown error'}. You are still signed in. Check your connection and try again.`, { title: 'Delete failed', ok: 'OK' });
      return;
    }
    markIntentionalSignOut();
    await LB.signOut();
  };

  // Coaching derived values
  const hasCoaching = !!((store.coaching?.asCoach || []).filter(c => c.status === 'active').length > 0 || store.coaching?.asClient?.status === 'active');
  const selfOn = !!store.settings?.beYourOwnCoach;
  const coachingTabOn = !!(store.settings?.showCoachingTab || hasCoaching || selfOn);

  // With an active coaching relationship the tab is forced on (coachingTabOn
  // ORs hasCoaching in), so the switch used to spring right back while quietly
  // clearing beYourOwnCoach as a side effect, without ending the self-coaching
  // relationship. Disable it in that state instead of pretending it does
  // something, and stop touching beYourOwnCoach here: turning self-coaching
  // off is toggleSelf's job, which also ends the relationship server-side.
  const coachingTabLocked = hasCoaching;
  // Drive setup is a coach-side capability, not a consequence of already
  // having a client. An explicitly pinned Coaching tab means the user has
  // opted into the coach workspace and must be able to prepare Drive before
  // sending the first invite. Self-coaching is the same coach workspace with
  // a self relationship, so it gets the identical archive experience.
  const hasExternalCoachRole = (store.coaching?.asCoach || []).some(c => c.status === 'active' && c.coachId !== c.clientId);
  const hasSelfCoachRole = selfOn && !!store.coaching?.asSelf;
  const isDriveCoach = hasExternalCoachRole || hasSelfCoachRole || !!store.settings?.showCoachingTab;
  useEffectSet(() => {
    if (!coachingSheet || !isDriveCoach) return;
    let alive = true;
    setDriveLoading(true); setDriveMessage(null);
    LB.getCoachingDriveStatus().then(value => { if (alive) setDriveStatus(value); })
      .catch(error => { if (alive) setDriveMessage(error.message || 'Drive status unavailable'); })
      .finally(() => { if (alive) setDriveLoading(false); });
    return () => { alive = false; };
  }, [coachingSheet, isDriveCoach, userId]);
  const connectDrive = async () => {
    setDriveLoading(true); setDriveMessage(null);
    try { window.location.assign(await LB.startCoachingDriveOAuth()); }
    catch (error) { setDriveMessage(error.message || 'Could not start Google authorization'); setDriveLoading(false); }
  };
  const disconnectDrive = async () => {
    setDriveLoading(true); setDriveMessage(null);
    try { await LB.disconnectCoachingDrive(); setDriveStatus(null); }
    catch (error) { setDriveMessage(error.message || 'Could not disconnect Google Drive'); }
    finally { setDriveLoading(false); }
  };
  const configureDrive = async (patch) => {
    setDriveLoading(true); setDriveMessage(null);
    try { await LB.configureCoachingDrive(patch); setDriveStatus(s => ({ ...(s || {}), archive_enabled: patch.archiveEnabled, include_photos: patch.includePhotos })); }
    catch (error) { setDriveMessage(error.message || 'Could not update Drive settings'); }
    finally { setDriveLoading(false); }
  };
  const toggleTab = () => {
    if (coachingTabLocked) return;
    setStore(s => ({ ...s, settings: { ...s.settings, showCoachingTab: !coachingTabOn } }));
  };
  const toggleSelf = async () => {
    const next = !selfOn;
    setStore(s => ({ ...s, settings: { ...s.settings, beYourOwnCoach: next } }));
    if (next) {
      try {
        await LB.enableSelfCoaching();
        const cs = await LB.reloadCoachingState(userId);
        setStore(s => s ? { ...s, coaching: { ...cs, anyClientLive: s.coaching?.anyClientLive, pendingCheckinsCount: s.coaching?.pendingCheckinsCount } } : s);
      } catch (e) {
        setStore(s => ({ ...s, settings: { ...s.settings, beYourOwnCoach: false } }));
      }
    } else {
      const selfId = store.coaching?.asSelf?.id;
      if (selfId) {
        try {
          await LB.endCoaching(selfId);
          const cs = await LB.reloadCoachingState(userId);
          setStore(s => s ? { ...s, coaching: { ...cs, anyClientLive: s.coaching?.anyClientLive, pendingCheckinsCount: s.coaching?.pendingCheckinsCount } } : s);
        } catch (e) {
          setStore(s => ({ ...s, settings: { ...s.settings, beYourOwnCoach: true } }));
        }
      }
    }
  };

  const activeCount = activeSessions.filter(s => !s.is_finished).length;

  // Same shape as WaterScreen's own patchSettings (screens-water.jsx): lets
  // the reused Water*Body components write through here exactly as they do
  // from the Water tracker itself.
  const patchSettings = (patch) => setStore(s => ({ ...s, settings: { ...s.settings, ...patch } }));

  const workoutImportSessions = workoutImportPreview?.sessions || [];
  const workoutImportSample = workoutImportSessions[Math.min(workoutImportPreviewIndex, Math.max(0, workoutImportSessions.length - 1))] || null;
  const workoutImportFormatSet = (set) => {
    const load = set?.kg != null ? `${Number(set.kg).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${workoutImportPreview?.targetUnit === 'lbs' ? 'lbs' : 'kg'}` : null;
    const reps = set?.reps != null ? `${set.reps} reps` : (set?.repsL != null || set?.repsR != null ? `${set.repsL ?? '–'} / ${set.repsR ?? '–'} reps` : null);
    const time = set?.timeSec != null ? `${set.timeSec}s` : null;
    return [load, reps, time].filter(Boolean).join(' · ') || 'No measurable value';
  };
  const planImportDays = planImportPreview?.days || [];
  const planImportSampleDay = planImportDays[Math.min(planImportDayIndex, Math.max(0, planImportDays.length - 1))] || null;
  const planImportFormatItem = (item) => {
    if (Array.isArray(item?.repsPerSet) && item.repsPerSet.length > 1) return `${item.sets} sets · ${item.repsPerSet.join('/')}`;
    if (item?.repsMax != null) return `${item.sets} sets · ${item.reps}-${item.repsMax} reps`;
    if (Array.isArray(item?.timeSecPerSet) && item.timeSecPerSet.length) return `${item.sets} sets · ${item.timeSecPerSet[0]}s`;
    return `${item?.sets ?? 0} sets · ${item?.reps ?? 0} reps`;
  };
  const closeWorkoutImport = () => {
    setWorkoutImportSheet(false);
    setWorkoutImportPreview(null);
    setWorkoutImportError(null);
    setWorkoutImportStep(1);
    setWorkoutImportPreviewIndex(0);
    setWorkoutImportProgress({ pct: 0, phase: '' });
  };

  return (
    <Screen scroll={false}>
      <TopBar title="Settings" onBack={() => go({ name: 'home' })} />
      <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* ─── User ─── */}
        <Frame style={{ padding: '12px 14px' }}>
          <div className="micro" style={{ marginBottom: 6 }}>Nickname</div>
          <input value={nickname} onChange={e => setNickname(e.target.value)} onBlur={saveNickname} onKeyDown={e => e.key === 'Enter' && e.target.blur()} placeholder="Your name"
            style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: UI.ink, fontFamily: UI.fontUi, fontSize: 15, fontWeight: 500, padding: '0 0 2px', boxSizing: 'border-box' }} />
          <div className="micro" style={{ marginTop: 4 }}>{store.user?.email || userId}</div>
        </Frame>

        {/* ─── Category navigation ─── */}
        <Frame style={{ padding: '0 14px' }}>
          <NavRow label="Changelog" hint={(window.WHATS_NEW || [])[0]?.id} onTap={() => setChangelogSheet(true)} accent first />
          {hasActiveUsersAccess && (
            <NavRow label="Active users" hint={activeCount > 0 ? `${activeCount} active` : null} onTap={() => setActiveUsersSheet(true)} />
          )}
          <NavRow label="Coaching" onTap={() => setCoachingSheet(true)} />
          <NavRow label="Friends" onTap={() => setFriendsSheet(true)} />
          <NavRow label="Health & Nutrition" onTap={() => setHealthSheet(true)} />
          <NavRow label="Account" onTap={() => setAccountSheet(true)} />
          <NavRow label="Training" onTap={() => setTrainingSheet(true)} />
          <NavRow label="Appearance" onTap={() => setAppearanceSheet(true)} />
          <NavRow label="Data" onTap={() => setDataSheet(true)} />
        </Frame>

      </div>
      </div>
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 20px', paddingBottom: 'calc(env(safe-area-inset-bottom, 8px) + 16px)', borderTop: `var(--hair-width) solid ${UI.hair}`, background: UI.bg, backgroundImage: 'var(--bg-texture)' }}>
        <Btn kind="ghost" onClick={() => LB.clearCachesAndReload()}>Clear cache &amp; reload</Btn>
        <Btn kind="ghost" className="intensity-glow" onClick={() => setGuidesSheet(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          Guides
        </Btn>
        {isAdmin ? (() => {
          const unseenCount = allUsers.filter(isNewSignup).length;
          const adminUnread = supportInbox.reduce((sum, t) => sum + Number(t.unread_count || 0), 0);
          const hasBadge = unseenCount > 0 || adminUnread > 0;
          return (
            <Btn kind="ghost" onClick={() => setAdminSheet(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              Admin
              {hasBadge && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, animation: 'pulseDot 1.5s ease-in-out infinite' }} />}
            </Btn>
          );
        })() : (
          <Btn onClick={() => setSupportSheet(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            Support Center
            {store.supportUnread > 0 && (
              <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--accent-ink)', flexShrink: 0, animation: 'pulseDot 1.5s ease-in-out infinite' }} />
            )}
          </Btn>
        )}
        <Btn kind="ghost" onClick={handleSignOut} style={{ color: UI.danger, background: 'rgba(var(--danger-rgb),0.08)', borderColor: 'rgba(var(--danger-rgb),calc(0.2 * var(--danger-border-boost)))' }}>Sign out</Btn>
        <div className="micro" style={{ textAlign: 'center', marginTop: 4 }}>Zane · {swVersion || '…'} · Data in Supabase</div>
      </div>

      {confirmEl}

      {/* ══ Guides Sheet (How to tours + Feature map + Autoregulation, one umbrella entry) ══ */}
      <SettingsSheet open={guidesSheet} onClose={() => setGuidesSheet(false)} title="Guides">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { icon: 'fa-compass', title: 'How to…', sub: 'Guided tours of the app', sheet: 'howto' },
            { icon: 'fa-diagram-project', title: 'Feature map', sub: 'What the app can do', route: 'featuremap' },
            { icon: 'fa-sliders', title: 'Autoregulation', sub: 'How the plan adapts to you', route: 'autoreg-guide' },
          ].map(g => (
            <button key={g.title} onClick={() => { setGuidesSheet(false); if (g.sheet === 'howto') setHowToSheet(true); else go({ name: g.route }); }} style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', cursor: 'pointer',
              background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, padding: '13px 14px',
              WebkitTapHighlightColor: 'transparent', font: 'inherit', color: UI.ink, textShadow: 'none',
            }}>
              <span style={{ width: 34, height: 34, borderRadius: 6, background: 'rgba(var(--accent-rgb),0.18)', border: `var(--hair-width) solid ${UI.hairStrong}`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <i className={`fa-solid ${g.icon}`} style={{ fontSize: 14, color: UI.gold }} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontFamily: UI.fontUi, fontSize: 14, fontWeight: 600, color: UI.ink }}>{g.title}</span>
                <span style={{ display: 'block', fontFamily: UI.fontUi, fontSize: 12, color: UI.inkFaint, marginTop: 2 }}>{g.sub}</span>
              </span>
              <i className="fa-solid fa-chevron-right" style={{ fontSize: 11, color: UI.inkGhost }} />
            </button>
          ))}
        </div>
      </SettingsSheet>

      {/* ══ Active Users Sheet ══ */}
      <SettingsSheet open={activeUsersSheet} onClose={() => setActiveUsersSheet(false)} title="Active users">
        {(() => {
          // Guarded: this IIFE runs on every render of this screen regardless
          // of whether the sheet is actually open (SettingsSheet stays
          // mounted for its close animation), so a corrupt value under this
          // key would otherwise throw on every single visit to Settings.
          let dismissed = [];
          try {
            const parsed = JSON.parse(localStorage.getItem('logbook-dismissed-sessions') || '[]');
            dismissed = Array.isArray(parsed) ? parsed : [];
          } catch (_) { dismissed = []; }
          const hiddenCount = activeSessions.filter(s => s.is_finished && dismissed.includes(s.session_id)).length;
          const visibleSessions = activeSessions.filter(s => !s.is_finished || !dismissed.includes(s.session_id));
          const sortedSessions = [...visibleSessions].sort((a, b) =>
            new Date(b.ended ?? b.started_at) - new Date(a.ended ?? a.started_at)
          );
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {hiddenCount > 0 && (
                <button onClick={() => { localStorage.removeItem('logbook-dismissed-sessions'); setActiveSessions(s => [...s]); }} style={{
                  alignSelf: 'flex-end', background: 'none', border: 'none', cursor: 'pointer',
                  color: UI.gold, fontFamily: UI.fontUi, fontSize: 10,
                  letterSpacing: '0.1em', textTransform: 'uppercase', padding: '0 0 10px',
                }}>Show all ({hiddenCount} hidden)</button>
              )}
              {sortedSessions.length === 0
                ? <div className="micro" style={{ color: UI.inkFaint, padding: '4px 0' }}>Nobody training right now.</div>
                : sortedSessions.map((s, i) => {
                  const isFinished = s.is_finished;
                  if (isFinished) {
                    const finishedMin = s.ended ? Math.round((nowS - new Date(s.ended).getTime()) / 60000) : null;
                    const finishedStr = finishedMin != null ? (finishedMin < 60 ? `${finishedMin}m ago` : `${Math.round(finishedMin / 60)}h ago`) : 'done';
                    return (
                      <div key={s.session_id} onClick={() => go({ name: 'spectator', targetUserId: s.user_id, userName: s.user_name, sessionId: s.session_id })}
                        style={{ display: 'grid', gridTemplateColumns: '12px 1fr 1fr 1fr', alignItems: 'center', gap: 10, padding: '9px 12px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: UI.inkFaint }} />
                        <span style={{ fontSize: 13, color: UI.inkSoft, fontWeight: 500, fontFamily: UI.fontUi }}>{s.user_name}</span>
                        <span className="display-it" style={{ fontSize: 13, color: UI.inkFaint, textAlign: 'center' }}>{s.day_name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                          <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{finishedStr}</span>
                          <svg width="5" height="9" viewBox="0 0 6 10" fill="none" stroke={UI.inkFaint} strokeWidth="1.2" strokeLinecap="round"><path d="M1 1l4 4-4 4" /></svg>
                        </div>
                      </div>
                    );
                  }
                  const blended = LB.calcBlended(s.started_at, s.avg_duration_seconds, s.avg_sets_total, s.sets_done, s.sets_total, nowS);
                  const remMin = blended?.remainingMin ?? null; const ratio = blended?.progress ?? null; const finishing = remMin === 0;
                  return (
                    <div key={s.session_id || i} onClick={() => go({ name: 'spectator', targetUserId: s.user_id, userName: s.user_name })}
                      style={{ display: 'grid', gridTemplateColumns: '12px 1fr 1fr 1fr', alignItems: 'center', gap: 10, padding: '9px 12px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', animation: 'pulseDot 1.4s ease-in-out infinite' }} />
                      <span style={{ fontSize: 13, color: UI.ink, fontWeight: 500, fontFamily: UI.fontUi }}>{s.user_name}</span>
                      <span className="display-it" style={{ fontSize: 13, color: UI.inkSoft, textAlign: 'center' }}>{s.day_name}</span>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
                        {ratio !== null ? (
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                            <span className="num" style={{ fontSize: 11, color: finishing ? 'var(--accent-light)' : 'var(--accent)' }}>{finishing ? 'soon' : `~${remMin}m`}</span>
                            <div style={{ width: 40, height: 2, borderRadius: 999, background: UI.hairStrong, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${ratio * 100}%`, background: 'var(--accent)', borderRadius: 999 }} />
                            </div>
                          </div>
                        ) : <span className="num" style={{ fontSize: 11, color: UI.inkFaint }}>{s.sets_done}/{s.sets_total}</span>}
                        <svg width="5" height="9" viewBox="0 0 6 10" fill="none" stroke={UI.inkFaint} strokeWidth="1.2" strokeLinecap="round"><path d="M1 1l4 4-4 4" /></svg>
                      </div>
                    </div>
                  );
                })
              }
              {isAdmin && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
                  <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>ACCESS</div>
                  {activeGrants.length === 0 && <div className="micro" style={{ color: UI.inkGhost, marginBottom: 8 }}>No other users have access yet.</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {activeGrants.map(email => (
                      <div key={email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6 }}>
                        <span style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi }}>{email}</span>
                        <button onClick={() => removeGrant(email)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.danger, fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <input value={newGrantEmail} onChange={e => setNewGrantEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addGrant()} placeholder="email@example.com"
                      style={{ flex: 1, background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4, padding: '7px 10px', color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none' }} />
                    <button onClick={addGrant} disabled={!newGrantEmail.includes('@')} style={{ padding: '7px 14px', borderRadius: 4, border: 'none', cursor: 'pointer', background: newGrantEmail.includes('@') ? UI.gold : UI.bgInset, color: newGrantEmail.includes('@') ? 'var(--accent-ink)' : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, textShadow: 'none' }}>Add</button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Coaching Sheet ══ */}
      <SettingsSheet open={coachingSheet} onClose={() => setCoachingSheet(false)} title="Coaching">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Row label="Coaching tab" first>
            <Toggle on={coachingTabOn} onToggle={toggleTab} disabled={coachingTabLocked} />
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            {coachingTabLocked
              ? 'The coaching tab stays pinned while a coaching relationship is active.'
              : 'Pin the coaching tab to the nav bar. Shows automatically when a coaching relationship is active.'}
          </div>
          {coachingTabOn && (
            <div style={{ marginTop: 12 }}>
              <Row label="Be your own coach">
                <Toggle on={selfOn} onToggle={toggleSelf} />
              </Row>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
                Track your own training like a coach would, stats, nutrition, check-ins & notes, just for you.
              </div>
            </div>
          )}
          {isDriveCoach && (
            <div style={{ marginTop: 22, paddingTop: 16, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
              <div className="micro-gold" style={{ marginBottom: 7 }}>GOOGLE DRIVE ARCHIVE</div>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5, marginBottom: 10 }}>
                Save your own and client check-ins as Google Sheets in Drive, plus one overview sheet. Drive failures never block check-in submission.
              </div>
              {!driveStatus && <Btn style={{ width: '100%' }} onClick={connectDrive} disabled={driveLoading}>{driveLoading ? 'Loading…' : 'Connect Google Drive'}</Btn>}
              {driveStatus && <>
                <div style={{ padding: '9px 11px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, marginBottom: 8 }}>
                  <div style={{ color: driveStatus.status === 'connected' ? 'var(--ok)' : UI.danger, fontWeight: 700 }}>
                    {driveStatus.status === 'needs_reauth' ? 'Reconnect required' : driveStatus.status === 'connected' ? 'Connected' : 'Not connected'}
                  </div>
                  {driveStatus.google_account_email && <div style={{ marginTop: 3 }}>{driveStatus.google_account_email}</div>}
                </div>
                <Row label="Archive check-ins">
                  <Toggle on={driveStatus.status === 'connected' && driveStatus.archive_enabled !== false} onToggle={() => configureDrive({ archiveEnabled: driveStatus.archive_enabled === false, includePhotos: driveStatus.include_photos === true })} disabled={driveLoading || driveStatus.status !== 'connected'} />
                </Row>
                <Row label="Include check-in photos">
                  <Toggle on={driveStatus.status === 'connected' && driveStatus.include_photos === true} onToggle={() => configureDrive({ archiveEnabled: driveStatus.archive_enabled !== false, includePhotos: driveStatus.include_photos !== true })} disabled={driveLoading || driveStatus.status !== 'connected'} />
                </Row>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <Btn style={{ flex: 1 }} onClick={connectDrive} disabled={driveLoading}>Reconnect</Btn>
                  <Btn kind="ghost" style={{ flex: 1 }} onClick={disconnectDrive} disabled={driveLoading}>Disconnect</Btn>
                </div>
              </>}
              {driveMessage && <div style={{ color: UI.danger, fontSize: 11, fontFamily: UI.fontUi, marginTop: 8 }}>{driveMessage}</div>}
            </div>
          )}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setCoachingSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Health & Nutrition Sheet: top-level hub, four independently
          toggleable sub-categories. Each has its OWN "Show tab" switch (see
          each sub-sheet below) instead of one bundled switch that used to
          turn Health, Water and Food on or off together. ══ */}
      <SettingsSheet open={friendsSheet} onClose={closeFriendsSettings} title="Friends">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Row label="Friends tab" first>
            <Toggle on={!!store.settings?.showFriendsTab} onToggle={() => {
              const enabling = !store.settings?.showFriendsTab;
              patchSettings({ showFriendsTab: enabling });
            }} />
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            Friends is in preview. Turn this on to test friends, private groups, messaging, metric sharing, live workout feedback and plan snapshots. Friends and Coaching share one navigation slot; use the social tab's long press to choose between them. You choose which metrics and workout details are visible.
          </div>
          <div style={{ marginTop: 16 }}>
            <NavRow
              label="Notifications"
              hint={`${[
                store.settings?.socialPushMessages ?? true,
                store.settings?.socialPushFriendRequests ?? true,
                store.settings?.socialPushFinishedComments ?? false,
                store.settings?.socialPushFriendStarted ?? false,
              ].filter(Boolean).length} of 4 on`}
              onTap={() => setFriendsNotificationsSheet(true)}
              first
            />
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5, marginTop: 5 }}>
              Choose which friend activity may reach you as a push notification.
            </div>
          </div>
          {!!store.settings?.showFriendsTab && !socialProfileDraft && socialProfileLoadError && <div style={{ marginTop: 22, paddingTop: 16, borderTop: `var(--hair-width) solid ${UI.hair}`, color: UI.danger, fontFamily: UI.fontUi, fontSize: 11 }}>
            <div>{socialProfileLoadError}</div>
            <button type="button" onClick={() => setSocialProfileRetry(value => value + 1)} style={{ marginTop: 9, padding: '7px 10px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: 'transparent', color: UI.gold, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Retry</button>
          </div>}
          {!!store.settings?.showFriendsTab && !socialProfileDraft && !socialProfileLoadError && <div style={{ marginTop: 22, paddingTop: 16, borderTop: `var(--hair-width) solid ${UI.hair}`, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11 }}>
            {socialProfileLoading ? 'Loading your social profile...' : 'Social profile is not available yet.'}
          </div>}
          {!!store.settings?.showFriendsTab && socialProfileDraft && <div style={{ marginTop: 22, paddingTop: 16, borderTop: `var(--hair-width) solid ${UI.hair}` }}>
            <div className="micro" style={{ color: UI.gold, marginBottom: 9 }}>YOUR SOCIAL PROFILE</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={socialProfileDraft.handle || ''}
                onChange={e => setSocialProfileDraft(p => ({ ...(p || {}), handle: e.target.value }))}
                placeholder="@zane_handle"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                style={{ ...SETTINGS_INPUT_STYLE, flex: 1 }}
              />
              <Btn onClick={() => saveSocialProfile(socialProfileDraft)} disabled={socialProfileSaving} style={{ padding: '10px 12px', minHeight: 0, fontSize: 10 }}>
                {socialProfileSaving ? 'Saving' : 'Save'}
              </Btn>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
              <span className="micro" style={{ color: UI.inkFaint }}>FRIEND CODE</span>
              <span className="num" style={{ color: UI.ink, letterSpacing: '0.12em' }}>{socialProfileDraft.friendCode || '...'}</span>
              <button onClick={() => navigator.clipboard?.writeText(socialProfileDraft.friendCode || '')} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: UI.gold, cursor: 'pointer', fontSize: 11 }}>Copy</button>
            </div>
            <div style={{ fontSize: 11, color: UI.inkFaint, lineHeight: 1.5, marginTop: 10 }}>
              Use your handle or friend code to connect. Metric sharing is opt-in and can be changed here any time.
            </div>
            {socialProfileMsg && !friendsSharingSheet && <div style={{ marginTop: 10, color: socialProfileMsg.ok ? UI.ok : UI.danger, fontFamily: UI.fontUi, fontSize: 11 }}>{socialProfileMsg.text}</div>}
            <div style={{ marginTop: 16 }}>
              <NavRow
                label="Metric sharing"
                hint={`${socialMetricCatalog.filter(metric => !!socialProfileDraft.metricVisibility?.[metric.key]).length} of ${socialMetricCatalog.length}`}
                onTap={() => setFriendsSharingSheet(true)}
                first
              />
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5, marginTop: 5 }}>
                Choose which health values friends can see.
              </div>
            </div>
          </div>}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={closeFriendsSettings}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      <SettingsSheet open={friendsNotificationsSheet} onClose={() => setFriendsNotificationsSheet(false)} title="Notifications">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5, marginBottom: 10 }}>
            These are native push notifications. Friends' live workout updates and in-app badges are not changed by these switches. Push notifications must also be enabled for this device.
          </div>
          <Row label="Direct and group messages" first>
            <Toggle on={store.settings?.socialPushMessages ?? true} onToggle={() => patchSettings({ socialPushMessages: !(store.settings?.socialPushMessages ?? true) })} />
          </Row>
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.45, margin: '3px 0 8px' }}>
            On by default. A message never opens a live workout overlay.
          </div>
          <Row label="Friend requests">
            <Toggle on={store.settings?.socialPushFriendRequests ?? true} onToggle={() => patchSettings({ socialPushFriendRequests: !(store.settings?.socialPushFriendRequests ?? true) })} />
          </Row>
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.45, margin: '3px 0 8px' }}>
            On by default, so a request cannot quietly get missed.
          </div>
          <Row label="Comments on finished workouts">
            <Toggle on={!!store.settings?.socialPushFinishedComments} onToggle={() => patchSettings({ socialPushFinishedComments: !store.settings?.socialPushFinishedComments })} />
          </Row>
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.45, margin: '3px 0 8px' }}>
            Off by default. Live comments and cheers never send a push.
          </div>
          <Row label="Friends starting a workout">
            <Toggle on={!!store.settings?.socialPushFriendStarted} onToggle={() => patchSettings({ socialPushFriendStarted: !store.settings?.socialPushFriendStarted })} />
          </Row>
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.45, margin: '3px 0 8px' }}>
            Off by default. Only one quiet start notification is sent per workout.
          </div>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setFriendsNotificationsSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      <SocialMetricSharingSheet
        open={friendsSharingSheet}
        onClose={() => setFriendsSharingSheet(false)}
        profile={socialProfileDraft}
        catalog={socialMetricCatalog}
        message={socialProfileMsg}
        saving={socialProfileSaving}
        onToggleMetric={toggleSocialMetric}
      />

      <SettingsSheet open={healthSheet} onClose={() => setHealthSheet(false)} title="Health & Nutrition">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 16, lineHeight: 1.5 }}>
            These four share one tab slot in the nav bar. Turn on whichever you actually use, any combination works: tap the slot to cycle through them, or long-press it to jump straight to one.
          </div>
          <div style={{ marginBottom: 16 }}>
            <Row label="Reporting week starts" first>
              <select
                value={LB.normalizeWeekStartDay(store.settings?.weekStartDay)}
                onChange={e => patchSettings({ weekStartDay: LB.normalizeWeekStartDay(e.target.value) })}
                aria-label="Reporting week starts"
                style={{
                  minWidth: 118,
                  background: UI.bgInset,
                  border: `var(--hair-width) solid ${UI.hairStrong}`,
                  borderRadius: 5,
                  color: UI.ink,
                  padding: '7px 8px',
                  fontFamily: UI.fontUi,
                  fontSize: 12,
                  colorScheme: 'dark',
                }}
              >
                {[
                  ['Monday', 0], ['Tuesday', 1], ['Wednesday', 2], ['Thursday', 3],
                  ['Friday', 4], ['Saturday', 5], ['Sunday', 6],
                ].map(([label, value]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Row>
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
              Sets the week used by Health summaries, Training stats, History groups, Friends metrics and coach check-ins. Training-plan days stay unchanged.
            </div>
          </div>
          <NavRow label="Health" first hint={store.settings?.showHealthTab ? 'On' : 'Off'} onTap={() => setHealthSubSheet(true)} />
          <NavRow label="Water" hint={store.settings?.showWaterTab ? 'On' : 'Off'} onTap={() => setWaterSubSheet(true)} />
          <NavRow label="Food" hint={store.settings?.showFoodTab ? 'On' : 'Off'} onTap={() => setFoodSubSheet(true)} />
          <NavRow label="Medications" hint={store.settings?.medsEnabled ? 'On' : 'Off'} onTap={() => setMedsSubSheet(true)} />
          {(store.statusPeriods || []).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <NavRow label="Sick & Vacation periods" first hint={`${(store.statusPeriods || []).length}`} onTap={() => { setShowAllPeriods(false); setPeriodsSheet(true); }} />
            </div>
          )}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setHealthSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Health › Health (glucose/body temp/cards) ══ */}
      <SettingsSheet open={healthSubSheet} onClose={() => setHealthSubSheet(false)} title="Health">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Row label="Show tab" first>
            <Toggle on={!!store.settings?.showHealthTab} onToggle={() => patchSettings({ showHealthTab: !store.settings?.showHealthTab })} />
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            Pin this to the shared tab slot to log daily weight, steps & macros and see your trends. These daily logs also prefill your weekly coach check-in.
          </div>
          {store.settings?.showHealthTab && (
            <div style={{ marginTop: 16 }}>
              <NavRow label="Glucose" first onTap={() => setGlucoseSheet(true)} />
              <NavRow label="Body Temperature" onTap={() => setBodyTempSheet(true)} />
              <NavRow label="Cards" hint={(store.settings?.hiddenHealthCards || []).length ? `${store.settings.hiddenHealthCards.length} hidden` : null} onTap={() => setHealthCardsSheet(true)} />
              <NavRow label="Daily log reminder" onTap={() => { setHealthSubSheet(false); setDailyLogReminderSheet(true); }} />
            </div>
          )}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setHealthSubSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Health › Daily log reminder (drill-in off Health, mirror of the
          training reminder sheet: toggle gated on push_enabled, time input,
          one nudge per local day when today's weight is still unlogged). ══ */}
      <SettingsSheet open={dailyLogReminderSheet} onClose={() => { setDailyLogReminderSheet(false); setHealthSubSheet(true); }} title="Daily log reminder">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <Row label="Enabled" first>
            <Toggle on={dailyLogReminderEnabled} onToggle={() => { toggleDailyLogReminder(); if (dailyLogReminderEnabled) setDailyLogReminderSheet(false); }} />
          </Row>
          {dailyLogReminderEnabled && (
            <Row label="Notify at">
              <input type="time" value={dailyLogReminderTime} onChange={e => updateDailyLogReminderTime(e.target.value)}
                style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4, padding: '5px 10px', color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none', colorScheme: ['light', 'paper'].includes(store.settings?.darkMode ?? 'dark') ? 'light' : 'dark' }} />
            </Row>
          )}
          {dailyLogReminderEnabled && (
            <div className="micro" style={{ color: UI.inkFaint, textAlign: 'right', paddingTop: 6 }}>
              One nudge per day when today's weight is still unlogged.
            </div>
          )}
          <Btn onClick={() => setDailyLogReminderSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Health › Water: top-level hub, drills into Daily Goal, Bottle
          Tracker, Reminders and Drinks & Coffee. The hub itself
          (WaterSettingsHubBody) is the exact same component the Water
          tracker's own settings sheet uses (screens-water.jsx), so there is
          one source of truth rather than a second copy drifting apart. ══ */}
      <SettingsSheet open={waterSubSheet} onClose={() => setWaterSubSheet(false)} title="Water">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Row label="Show tab" first>
            <Toggle on={!!store.settings?.showWaterTab} onToggle={() => patchSettings({ showWaterTab: !store.settings?.showWaterTab })} />
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, marginBottom: 16, lineHeight: 1.5 }}>
            Pin this to the shared tab slot to log drinks toward a daily goal.
          </div>
          {store.settings?.showWaterTab && (
            <WaterSettingsHubBody settings={store.settings || {}}
              onOpenGoal={() => { setWaterSubSheet(false); setWaterGoalSheet(true); }}
              onOpenBottle={() => { setWaterSubSheet(false); setWaterBottleSheet(true); }}
              onOpenReminders={() => { setWaterSubSheet(false); setWaterRemindersSheet(true); }}
              onOpenDrinks={() => { setWaterSubSheet(false); setWaterDrinksConfigSheet(true); }} />
          )}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setWaterSubSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Health › Water › Daily Goal (push off Water, same reasoning as
          Drinks & Coffee below: one sheet open at a time keeps keyboard
          focus calm on the time/number inputs in this sheet). ══ */}
      <SettingsSheet open={waterGoalSheet} onClose={() => { setWaterGoalSheet(false); setWaterSubSheet(true); }} title="Daily Goal">
        <WaterGoalWindowBody settings={store.settings || {}} patchSettings={patchSettings}
          onClose={() => { setWaterGoalSheet(false); setWaterSubSheet(true); }} />
      </SettingsSheet>

      {/* ══ Health › Water › Bottle Tracker (push off Water) ══ */}
      <SettingsSheet open={waterBottleSheet} onClose={() => { setWaterBottleSheet(false); setWaterSubSheet(true); }} title="Bottle Tracker">
        <WaterBottleTrackerBody settings={store.settings || {}} patchSettings={patchSettings}
          onClose={() => { setWaterBottleSheet(false); setWaterSubSheet(true); }} />
      </SettingsSheet>

      {/* ══ Health › Water › Reminders (push off Water) ══ */}
      <SettingsSheet open={waterRemindersSheet} onClose={() => { setWaterRemindersSheet(false); setWaterSubSheet(true); }} title="Reminders">
        <WaterRemindersBody settings={store.settings || {}} patchSettings={patchSettings} go={go}
          onClose={() => { setWaterRemindersSheet(false); setWaterSubSheet(true); }} />
      </SettingsSheet>

      {/* ══ Health › Water › Drinks & coffee (push off Water, same as off the
          Water screen's own settings sheet, not a third simultaneous layer) ══ */}
      <SettingsSheet open={waterDrinksConfigSheet} onClose={() => { setWaterDrinksConfigSheet(false); setWaterSubSheet(true); }} title="Drinks & coffee">
        <WaterDrinksConfigBody settings={store.settings || {}} patchSettings={patchSettings}
          onClose={() => { setWaterDrinksConfigSheet(false); setWaterSubSheet(true); }} />
      </SettingsSheet>

      {/* ══ Health › Food: top-level hub, drills into Meal Planning and Meal
          Times rather than one long flat list of unrelated toggles. ══ */}
      <SettingsSheet open={foodSubSheet} onClose={() => setFoodSubSheet(false)} title="Food">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Row label="Show tab" first>
            <Toggle on={!!store.settings?.showFoodTab} onToggle={() => patchSettings({ showFoodTab: !store.settings?.showFoodTab })} />
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, marginBottom: 16, lineHeight: 1.5 }}>
            Pin this to the shared tab slot to log meals and macros.
          </div>
          {store.settings?.showFoodTab && (
            <>
              <NavRow label="Meal Planning" first hint={store.settings?.planMode ? 'On' : 'Off'} onTap={() => setMealPlanningSheet(true)} />
              <NavRow label="Meal Times" hint={mealCategoriesCustomized ? 'Customized' : null} onTap={() => setMealTimesSheet(true)} />
              <NavRow label="Intermittent Fasting" hint={store.settings?.fastingProtocol ? (store.settings.fastingProtocol === 'omad' ? 'OMAD' : store.settings.fastingProtocol) : 'Off'} onTap={() => setFastingSheet(true)} />
              {/* Only meaningful for the imperial unit preference: on kg (or
                  mixed) the food tracker is already grams, there's nothing to
                  opt out of. Portions/ingredients/cooked weights/shopping only,
                  macros stay grams for everyone regardless of this toggle (see
                  UI.massInOz, ui.jsx). */}
              {store.settings?.unit === 'lbs' && (
                <>
                  <Row label="Grams instead of oz/lb">
                    <Toggle on={!!store.settings?.foodForceGrams} onToggle={() => patchSettings({ foodForceGrams: !store.settings?.foodForceGrams })} />
                  </Row>
                  <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, marginBottom: 16, lineHeight: 1.5 }}>
                    Keep the food tracker in grams even though your unit preference is lbs. Macros stay grams either way, this only affects portions, ingredients, and the shopping list.
                  </div>
                </>
              )}
            </>
          )}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setFoodSubSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Health › Food › Meal Planning ══ */}
      <SettingsSheet open={mealPlanningSheet} onClose={() => setMealPlanningSheet(false)} title="Meal Planning">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Row label="Meal planning" first>
            <Toggle on={!!store.settings?.planMode} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, planMode: !s.settings?.planMode } }))} />
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            Plan meals ahead in the Food Tracker and check them off as you eat. Adds a "Plan" option next to "Log" when you add food, and a projected total for the day. Off by default: with it off the Food Tracker works exactly as before.
          </div>
          {store.settings?.planMode && (
            <div style={{ marginTop: 16 }}>
              <Row label="Meal reminders" first>
                <Toggle on={!!store.settings?.mealReminderEnabled} onToggle={() => {
                  const next = !store.settings?.mealReminderEnabled;
                  // Push not active, so send them to the push sheet first, same
                  // as the training reminder toggle does, instead of enabling a
                  // reminder that can never be delivered.
                  if (next && !pushEnabled) { setMealPlanningSheet(false); setPushSheet(true); return; }
                  setStore(s => ({ ...s, settings: { ...s.settings, mealReminderEnabled: next } }));
                }} />
              </Row>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
                Get a nudge when a planned meal is still unlogged an hour after its time. Needs notifications on.
              </div>
            </div>
          )}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setMealPlanningSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Health › Food › Meal Times: the display toggle and the time
          boundaries live together, "hide categories" is really "stop
          grouping by these very boundaries". ══ */}
      <SettingsSheet open={mealTimesSheet} onClose={closeMealTimes} title="Meal Times">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Row label="Hide meal categories" first>
            <Toggle on={!!store.settings?.hideFoodCategories} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, hideFoodCategories: !s.settings?.hideFoodCategories } }))} />
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            Show the Food Tracker's daily timeline as one flat hour list instead of grouping it under Breakfast/Lunch/Dinner header cards. Every hour still has its own "+" to log or plan something.
          </div>
          {/* User-defined meal categories. Editing START hours (each category
              runs to the next one's start) keeps gaps and overlaps impossible.
              The first category is pinned to 00:00 so the day is covered end
              to end. */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 10, lineHeight: 1.5 }}>
              Name your meal groups and choose when each one starts. Each runs until the next begins.
            </div>
            {draftMealCats.map((cat, i) => (
              <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderTop: i ? `var(--hair-width) solid ${UI.hair}` : 'none' }}>
                <input value={cat.label} onChange={e => updateMealCategoryLabel(i, e.target.value)}
                  onBlur={() => persistMealCategories(draftMealCats)}
                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  aria-label={`Name for meal category ${i + 1}`} style={{ ...SETTINGS_INPUT_STYLE, flex: 1, minWidth: 0, padding: '7px 9px', fontSize: 13 }} />
                {i === 0 ? (
                  <span className="num" style={{ fontSize: 13, color: UI.inkFaint }}>00:00</span>
                ) : (
                  <>
                    <button onClick={() => shiftMealStart(i, -1)} disabled={cat.startHour <= draftMealCats[i - 1].startHour + 1}
                      aria-label={`${cat.label} earlier`} style={mealStepBtn(cat.startHour <= draftMealCats[i - 1].startHour + 1)}>
                      <i className="fa-solid fa-minus" style={{ fontSize: 10 }} />
                    </button>
                    <span className="num" style={{ width: 44, textAlign: 'center', fontSize: 13, color: UI.ink }}>{String(cat.startHour).padStart(2, '0')}:00</span>
                    <button onClick={() => shiftMealStart(i, 1)} disabled={cat.startHour >= (i === draftMealCats.length - 1 ? 23 : draftMealCats[i + 1].startHour - 1)}
                      aria-label={`${cat.label} later`} style={mealStepBtn(cat.startHour >= (i === draftMealCats.length - 1 ? 23 : draftMealCats[i + 1].startHour - 1))}>
                      <i className="fa-solid fa-plus" style={{ fontSize: 10 }} />
                    </button>
                  </>
                )}
                {draftMealCats.length > 1 && (
                  <button onClick={() => removeMealCategory(i)} aria-label={`Remove ${cat.label}`} style={{ ...mealStepBtn(false), color: UI.inkFaint }}>
                    <i className="fa-solid fa-xmark" style={{ fontSize: 11 }} />
                  </button>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12 }}>
              <button onClick={addMealCategory} disabled={draftMealCats.length >= 24} style={{
                background: 'none', border: 'none', padding: 0, cursor: draftMealCats.length >= 24 ? 'default' : 'pointer',
                color: draftMealCats.length >= 24 ? UI.inkGhost : 'var(--accent)', fontFamily: UI.fontUi, fontSize: 12, WebkitTapHighlightColor: 'transparent',
              }}><i className="fa-solid fa-plus" style={{ marginRight: 6, fontSize: 10 }} />Add meal category</button>
              {mealCategoriesCustomized && (
                <button onClick={resetMealCategories} style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 12, WebkitTapHighlightColor: 'transparent',
                }}>Reset defaults</button>
              )}
            </div>
          </div>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={closeMealTimes}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Health › Food › Intermittent Fasting: only the protocol
          preference lives here, the running fast is per-device ══ */}
      <SettingsSheet open={fastingSheet} onClose={() => setFastingSheet(false)} title="Intermittent Fasting">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 20, lineHeight: 1.5 }}>
            Pick a fast/eat rhythm. The Food Tracker then shows a live fasting timer and tints today's eating window on the timeline. The protocol syncs to all your devices; the running fast itself stays on this device. Tap the active protocol again to switch it off.
          </div>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>Daily</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 22 }}>
            {LB.FD_FASTING_PRESETS.filter(p => !p.long).map(p => (
              <button key={p.id} onClick={() => patchSettings({ fastingProtocol: store.settings?.fastingProtocol === p.id ? null : p.id })}
                style={fastingChip(store.settings?.fastingProtocol === p.id)}>{p.label}</button>
            ))}
          </div>
          <div className="micro" style={{ color: UI.inkFaint, marginBottom: 8 }}>Long fast</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {LB.FD_FASTING_PRESETS.filter(p => p.long && !p.custom).map(p => (
              <button key={p.id} onClick={() => patchSettings({ fastingProtocol: store.settings?.fastingProtocol === p.id ? null : p.id })}
                style={fastingChip(store.settings?.fastingProtocol === p.id)}>{p.label}</button>
            ))}
            {/* Custom long fast: hours live in the id ('custom:96'), the
                stepper below edits them. The chip compares by resolved
                custom-ness, not the raw id. */}
            <button onClick={() => {
              const active = typeof store.settings?.fastingProtocol === 'string' && store.settings.fastingProtocol.startsWith('custom:');
              patchSettings({ fastingProtocol: active ? null : `custom:${fastingCustomHours}` });
            }} style={fastingChip(fastingCustomActive)}>Custom</button>
          </div>
          {fastingCustomActive && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12, padding: '10px 12px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6 }}>
              <span style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi }}>Fast hours</span>
              <Stepper value={fastingCustomHours} onChange={h => { setFastingCustomHours(h); patchSettings({ fastingProtocol: `custom:${h}` }); }}
                step={6} min={24} max={168} suffix="h" />
            </div>
          )}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setFastingSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Health › Medications ══ */}
      <SettingsSheet open={medsSubSheet} onClose={() => setMedsSubSheet(false)} title="Medications">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Row label="Show tab" first>
            <Toggle on={!!store.settings?.medsEnabled} onToggle={() => patchSettings({ medsEnabled: !store.settings?.medsEnabled })} />
          </Row>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            Pin this to the shared tab slot to track medications, vitamins & supplements. Off by default, not everyone wants to deal with medications.
          </div>
          {store.settings?.medsEnabled && (
            <div style={{ marginTop: 16 }}>
              <Row label="Dose reminders" first>
                <Toggle on={!!store.settings?.medicationReminderEnabled} onToggle={() => {
                  const next = !store.settings?.medicationReminderEnabled;
                  // Push not active, so send them to the push sheet first, same
                  // as the meal-reminder toggle does, instead of enabling a
                  // reminder that can never be delivered.
                  if (next && !pushEnabled) { setMedsSubSheet(false); setPushSheet(true); return; }
                  setStore(s => ({ ...s, settings: { ...s.settings, medicationReminderEnabled: next } }));
                }} />
              </Row>
              <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, marginBottom: 16, lineHeight: 1.5 }}>
                Get a nudge when a scheduled dose is still unlogged an hour after its time, a second nudge two hours later, max two per day. After the first nudge you can snooze a still-due dose for an hour, or cancel the snooze again, right on its timeline row; the next nudge fires right when the snooze ends. Needs notifications on.
              </div>
              <NavRow label="Pillbox"
                hint={Array.isArray(store.settings?.pillboxSlots) && store.settings.pillboxSlots.length ? `${store.settings.pillboxSlots.length} set` : null}
                onTap={() => { setMedsSubSheet(false); setPillboxSheet(true); }} />
            </div>
          )}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setMedsSubSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Health › Medications › Pillbox (push off Medications, same
          reasoning as Water's own sub-sheets: this one has real text/number
          inputs, so only one sheet stays open at a time). ══ */}
      <SettingsSheet open={pillboxSheet} onClose={() => { setPillboxSheet(false); setMedsSubSheet(true); }} title="Pillbox compartments">
        <MdPillboxSlotsBody settings={store.settings || {}} patchSettings={patchSettings}
          onClose={() => { setPillboxSheet(false); setMedsSubSheet(true); }} />
      </SettingsSheet>

      {/* ══ Health › Glucose ══ */}
      <SettingsSheet open={glucoseSheet} onClose={() => setGlucoseSheet(false)} title="Glucose">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Row label="Blood glucose unit" first>
            <div style={{ display: 'flex', gap: 0, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, overflow: 'hidden' }}>
              {['mmol', 'mgdl'].map(u => (
                <button key={u} onClick={() => setStore(s => ({ ...s, settings: { ...s.settings, glucoseUnit: u } }))}
                  style={{ padding: '5px 12px', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600,
                    background: (store.settings?.glucoseUnit ?? 'mmol') === u ? 'var(--accent)' : 'transparent',
                    color: (store.settings?.glucoseUnit ?? 'mmol') === u ? 'var(--accent-ink)' : UI.inkSoft,
                    border: 'none', cursor: 'pointer', transition: 'background 0.15s', textShadow: 'none' }}>
                  {u === 'mmol' ? 'mmol/L' : 'mg/dL'}
                </button>
              ))}
            </div>
          </Row>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setGlucoseSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Health › Body Temperature ══ */}
      <SettingsSheet open={bodyTempSheet} onClose={() => setBodyTempSheet(false)} title="Body Temperature">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 4, lineHeight: 1.5 }}>
            Defaults to °F on Imperial, °C otherwise. Override it here if that's wrong for you.
          </div>
          <Row label="Body temperature unit" first>
            <div style={{ display: 'flex', gap: 0, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, overflow: 'hidden' }}>
              {['c', 'f'].map(u => (
                <button key={u} onClick={() => setStore(s => ({ ...s, settings: { ...s.settings, tempUnit: u } }))}
                  style={{ padding: '5px 12px', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600,
                    background: LB.defaultTempUnit(store.settings) === u ? 'var(--accent)' : 'transparent',
                    color: LB.defaultTempUnit(store.settings) === u ? 'var(--accent-ink)' : UI.inkSoft,
                    border: 'none', cursor: 'pointer', transition: 'background 0.15s', textShadow: 'none' }}>
                  {u === 'c' ? '°C' : '°F'}
                </button>
              ))}
            </div>
          </Row>
          {(() => {
            const feverUnit = LB.defaultTempUnit(store.settings);
            const c2f = (n) => Math.round((n * 9 / 5 + 32) * 10) / 10;
            const f2c = (n) => (n - 32) * 5 / 9;
            const feverC = store.settings?.feverThresholdC ?? 38;
            const feverDisp = feverUnit === 'f' ? c2f(feverC) : feverC;
            const feverMin = feverUnit === 'f' ? c2f(36) : 36;
            const feverMax = feverUnit === 'f' ? c2f(42) : 42;
            return (
              <Row label="Sick suggestion at">
                <Stepper value={feverDisp} step={0.1} min={feverMin} suffix={feverUnit === 'f' ? '°F' : '°C'}
                  onChange={v => {
                    const clamped = Math.min(feverMax, v);
                    const newC = feverUnit === 'f' ? f2c(clamped) : clamped;
                    setStore(s => ({ ...s, settings: { ...s.settings, feverThresholdC: Math.round(newC * 100) / 100 } }));
                  }} />
              </Row>
            );
          })()}
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: 6, lineHeight: 1.5 }}>
            Log a body temperature at or above this, and we'll ask if you want to mark today as Sick.
          </div>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setBodyTempSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Health Cards Sheet ══ */}
      <SettingsSheet open={healthCardsSheet} onClose={() => setHealthCardsSheet(false)} title="Cards">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 12, lineHeight: 1.5 }}>
            Hide cards you don't use. Drag a card's grip in the Health tab to reorder the rest.
          </div>
          {HEALTH_CARD_TOGGLES.map((c, i) => {
            const hidden = (store.settings?.hiddenHealthCards || []).includes(c.id);
            return (
              <React.Fragment key={c.id}>
                <Row label={c.label} first={i === 0}>
                  <Toggle on={!hidden} onToggle={() => setStore(s => {
                    const cur = s.settings?.hiddenHealthCards || [];
                    const next = hidden ? cur.filter(x => x !== c.id) : [...cur, c.id];
                    return { ...s, settings: { ...s.settings, hiddenHealthCards: next } };
                  })} />
                </Row>
                {c.id === 'macroGroup' && (
                  <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, marginTop: -4, marginBottom: 6, lineHeight: 1.5 }}>
                    Also hides the button to set/edit your macro targets. Come back here to bring it back.
                  </div>
                )}
              </React.Fragment>
            );
          })}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setHealthCardsSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Sick & Vacation Periods Sheet ══ */}
      <SettingsSheet open={periodsSheet} onClose={() => setPeriodsSheet(false)} title="Sick & Vacation periods">
        {(() => {
          const allPeriods = (store.statusPeriods || []);
          const PREVIEW = 5;
          const visible = showAllPeriods ? allPeriods : allPeriods.slice(0, PREVIEW);
          const todayStr = LB.todayISO();
          const updatePeriod = async (id, patch) => {
            let prev = null;
            setStore(s => { prev = s.statusPeriods || []; return { ...s, statusPeriods: (s.statusPeriods || []).map(p => p.id === id ? { ...p, ...patch } : p) }; });
            const { error } = await LB.supabase.from('zane_status_periods').update(
              Object.fromEntries(Object.entries(patch).map(([k, v]) => [k === 'startedAt' ? 'started_at' : k === 'endedAt' ? 'ended_at' : k, v]))
            ).eq('id', id);
            if (error) {
              if (prev) setStore(s => ({ ...s, statusPeriods: prev }));
              await confirm(error.message || 'Could not update this period.', { title: 'Update failed', ok: 'OK' });
            }
          };
          const deletePeriod = async (id) => {
            setConfirmDeletePeriodId(null);
            let prev = null;
            setStore(s => { prev = s.statusPeriods || []; return { ...s, statusPeriods: (s.statusPeriods || []).filter(p => p.id !== id) }; });
            const { error } = await LB.supabase.from('zane_status_periods').delete().eq('id', id);
            if (error) {
              if (prev) setStore(s => ({ ...s, statusPeriods: prev }));
              await confirm(error.message || 'Could not delete this period.', { title: 'Delete failed', ok: 'OK' });
            }
          };
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {visible.map((p, i) => {
                const isActive = !p.endedAt;
                const icon = p.mode === 'sick' ? 'fa-bed-pulse' : p.mode === 'deload' ? 'fa-arrow-trend-down' : p.mode === 'cleanup' ? 'fa-broom' : 'fa-umbrella-beach';
                const label = p.mode === 'sick' ? 'SICK' : p.mode === 'deload' ? 'DELOAD' : p.mode === 'cleanup' ? 'CLEANUP' : 'VACATION';
                return (
                  <div key={p.id}>
                    {i > 0 && <div className="knurl" />}
                    <div style={{ padding: '12px 0', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <i className={`fa-solid ${icon}`} style={{ fontSize: 13, color: 'var(--accent)', marginTop: 2, width: 16, textAlign: 'center', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="micro" style={{ color: 'var(--accent)', marginBottom: 6 }}>{label}</div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          {/* LB.fmtISO(new Date(...)), not a bare slice: startedAt/endedAt
                              are UTC timestamps, slicing the first 10 chars gives the UTC
                              date, a different calendar day than local for a non-UTC viewer. */}
                          <input type="date" value={LB.fmtISO(new Date(p.startedAt))} max={p.endedAt ? LB.fmtISO(new Date(p.endedAt)) : todayStr}
                            onChange={e => e.target.value && updatePeriod(p.id, { startedAt: LB.parseDate(e.target.value).toISOString() })}
                            style={{ background: 'transparent', border: 'none', color: UI.inkSoft, fontFamily: UI.fontNum, fontSize: 12, cursor: 'pointer', outline: 'none', padding: 0 }} />
                          <span style={{ color: UI.inkFaint, fontSize: 11, fontFamily: UI.fontUi }}>→</span>
                          {isActive
                            // A cleanup period is opened when it is activated but
                            // dated to the next cycle start, so an open one whose
                            // start is still ahead is upcoming, not running.
                            ? <span style={{ fontSize: 12, fontFamily: UI.fontUi, color: 'var(--accent)', fontStyle: 'italic' }}>
                                {p.mode === 'cleanup' && !LB.cleanupStarted({ statusMode: p.mode, statusModeSince: p.startedAt }) ? 'upcoming' : 'ongoing'}
                              </span>
                            : <input type="date" value={LB.fmtISO(new Date(p.endedAt))} min={LB.fmtISO(new Date(p.startedAt))} max={todayStr}
                                onChange={e => e.target.value && updatePeriod(p.id, { endedAt: LB.parseDate(e.target.value).toISOString() })}
                                style={{ background: 'transparent', border: 'none', color: UI.inkSoft, fontFamily: UI.fontNum, fontSize: 12, cursor: 'pointer', outline: 'none', padding: 0 }} />
                          }
                        </div>
                      </div>
                      {confirmDeletePeriodId !== p.id && (
                        <button onClick={() => setConfirmDeletePeriodId(p.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: UI.inkFaint, WebkitTapHighlightColor: 'transparent', flexShrink: 0 }}>
                          <i className="fa-solid fa-trash-can" style={{ fontSize: 12 }} />
                        </button>
                      )}
                    </div>
                    {confirmDeletePeriodId === p.id && (
                      <div style={{ display: 'flex', gap: 8, paddingBottom: 14 }}>
                        <button onClick={() => setConfirmDeletePeriodId(null)} style={{ flex: 1, padding: '11px', background: UI.bgRaised, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 6, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, color: UI.inkFaint, WebkitTapHighlightColor: 'transparent', textShadow: 'none' }}>Cancel</button>
                        <button onClick={() => deletePeriod(p.id)} style={{ flex: 1, padding: '11px', background: 'rgba(var(--danger-rgb),0.12)', border: 'var(--hair-width) solid rgba(var(--danger-rgb),0.4)', borderRadius: 6, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600, color: UI.danger, WebkitTapHighlightColor: 'transparent' }}>Delete</button>
                      </div>
                    )}
                  </div>
                );
              })}
              {!showAllPeriods && allPeriods.length > PREVIEW && (
                <button onClick={() => setShowAllPeriods(true)} style={{ width: '100%', marginTop: 8, padding: '7px 0', background: 'none', border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 4, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer', WebkitTapHighlightColor: 'transparent', letterSpacing: '0.04em' }}>
                  Show all ({allPeriods.length})
                </button>
              )}
              {allPeriods.length === 0 && (
                <div style={{ color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No periods recorded yet.</div>
              )}
              <div style={{ marginTop: 24 }}>
                <Btn style={{ width: '100%' }} onClick={() => setPeriodsSheet(false)}>Done</Btn>
              </div>
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Account Sheet ══ */}
      <SettingsSheet open={accountSheet} onClose={() => setAccountSheet(false)} title="Account">
        <div>
          <div style={{ padding: '4px 0 18px' }}>
            <div className="micro" style={{ marginBottom: 7, color: UI.inkFaint }}>X HANDLE</div>
            <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5, marginBottom: 9 }}>
              Add your handle for future social features and public thanks when we share updates.
            </div>
            <input
              value={xHandleDraft}
              onChange={e => { setXHandleDraft(e.target.value); if (xHandleMsg) setXHandleMsg(null); }}
              onKeyDown={e => { if (e.key === 'Enter') saveXHandle(); }}
              placeholder="@yourhandle or x.com/yourhandle"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={SETTINGS_INPUT_STYLE}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <Btn onClick={saveXHandle} style={{ flex: 1, padding: '10px 14px', minHeight: 0, fontSize: 11 }}>
                Save handle
              </Btn>
              <Toggle on={xHandlePublicDraft} onToggle={toggleXHandlePublic} label="Show handle in future public social features" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginTop: 7 }}>
              <div style={{ flex: 1, fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.45 }}>
                {xHandlePublicDraft ? 'Public display is on for future social features.' : 'Public display is off. Admin support views can still see your handle.'}
              </div>
              <button onClick={optOutXHandle} style={{ flexShrink: 0, padding: '3px 0', border: 'none', background: 'none', color: UI.inkFaint, cursor: 'pointer', fontFamily: UI.fontUi, fontSize: 11, WebkitTapHighlightColor: 'transparent' }}>
                I don&apos;t use X
              </button>
            </div>
            {xHandleMsg && (
              <div style={{ marginTop: 8, fontSize: 11, color: xHandleMsg.ok ? 'var(--accent)' : UI.danger, fontFamily: UI.fontUi }}>
                {xHandleMsg.text}
              </div>
            )}
          </div>
          <div className="knurl" />
          <Row label="Push notifications" first>
            <button style={accentBtn} onClick={() => setPushSheet(true)}>Configure</button>
          </Row>
          {typeof window !== 'undefined' && window.PublicKeyCredential && (
            <NavRow label="Passkeys" onTap={() => setPasskeySheet(true)} />
          )}
          <NavRow label="Change password" onTap={() => { setPwMsg(null); setPwCurrent(''); setPwNew(''); setPwConfirm(''); setShowPw(false); setChangePasswordSheet(true); }} />
          <NavRow label="Change email" onTap={() => { setEmailMsg(null); setEmailNew(''); setChangeEmailSheet(true); }} />
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setAccountSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Passkey Sheet ══ */}
      <PasskeySheet open={passkeySheet} onClose={() => setPasskeySheet(false)} />

      {/* ══ Change Password Sheet ══ */}
      <SettingsSheet open={changePasswordSheet} onClose={() => { setChangePasswordSheet(false); setPwCurrent(''); setPwNew(''); setPwConfirm(''); setPwMsg(null); setShowPw(false); }} title="Change password">
        {(() => {
          const iStyle = SETTINGS_INPUT_STYLE;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 8 }}>
              <div>
                <div className="micro" style={{ marginBottom: 6 }}>CURRENT PASSWORD</div>
                <div style={{ position: 'relative' }}>
                  <input type={showPw ? 'text' : 'password'} value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} placeholder="Current password" style={{ ...iStyle, paddingRight: 40 }} autoComplete="current-password" />
                  <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1} aria-label={showPw ? 'Hide passwords' : 'Show passwords'}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: 4, cursor: 'pointer', color: showPw ? 'var(--accent)' : UI.inkFaint, display: 'flex', alignItems: 'center', WebkitTapHighlightColor: 'transparent' }}>
                    <i className={showPw ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye'} style={{ fontSize: 14 }} />
                  </button>
                </div>
              </div>
              <div>
                <div className="micro" style={{ marginBottom: 6 }}>NEW PASSWORD</div>
                <input type={showPw ? 'text' : 'password'} value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="Min. 6 characters" style={iStyle} autoComplete="new-password" />
              </div>
              <div>
                <div className="micro" style={{ marginBottom: 6 }}>CONFIRM NEW PASSWORD</div>
                <input type={showPw ? 'text' : 'password'} value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChangePassword()} placeholder="Repeat new password" style={iStyle} autoComplete="new-password" />
                {pwConfirm.length > 0 && pwNew !== pwConfirm && (
                  <div style={{ fontSize: 12, color: UI.danger, fontFamily: UI.fontUi, marginTop: 6 }}>Passwords do not match</div>
                )}
              </div>
              {pwMsg && (
                <div style={{ fontSize: 12, color: pwMsg.ok ? 'var(--accent)' : UI.danger, fontFamily: UI.fontUi, padding: '8px 12px', background: pwMsg.ok ? 'rgba(var(--accent-rgb),0.16)' : 'rgba(var(--danger-rgb),0.08)', borderRadius: 6 }}>
                  {pwMsg.text}
                </div>
              )}
              {!pwMsg?.ok
                ? <Btn onClick={handleChangePassword} disabled={!pwCurrent || !pwNew || !pwConfirm || pwNew !== pwConfirm || pwLoading}>{pwLoading ? 'Updating…' : 'Update password'}</Btn>
                : <Btn kind="ghost" onClick={() => { setChangePasswordSheet(false); setPwMsg(null); }}>Done</Btn>
              }
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Change Email Sheet ══ */}
      <SettingsSheet open={changeEmailSheet} onClose={() => { setChangeEmailSheet(false); setEmailNew(''); setEmailMsg(null); }} title="Change email">
        {(() => {
          const iStyle = SETTINGS_INPUT_STYLE;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 8 }}>
              <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.6 }}>
                Current: <span style={{ color: UI.inkSoft }}>{store.user?.email || ''}</span>
              </div>
              <div>
                <div className="micro" style={{ marginBottom: 6 }}>NEW EMAIL ADDRESS</div>
                <input type="email" value={emailNew} onChange={e => setEmailNew(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleChangeEmail()} placeholder="new@example.com" style={iStyle} autoComplete="email" autoCapitalize="none" spellCheck={false} />
              </div>
              {emailMsg && (
                <div style={{ fontSize: 12, color: emailMsg.ok ? 'var(--accent)' : UI.danger, fontFamily: UI.fontUi, padding: '8px 12px', background: emailMsg.ok ? 'rgba(var(--accent-rgb),0.16)' : 'rgba(var(--danger-rgb),0.08)', borderRadius: 6, lineHeight: 1.55 }}>
                  {emailMsg.text}
                </div>
              )}
              {!emailMsg?.ok
                ? <Btn onClick={handleChangeEmail} disabled={!emailNew.trim() || emailLoading}>{emailLoading ? 'Sending…' : 'Send confirmation'}</Btn>
                : <Btn kind="ghost" onClick={() => { setChangeEmailSheet(false); setEmailNew(''); setEmailMsg(null); }}>Done</Btn>
              }
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Training Sheet ══ */}
      <SettingsSheet open={trainingSheet} onClose={() => setTrainingSheet(false)} title="Training">
        <div>
          <NavRow label="Session" first onTap={() => setSessionBehaviourSheet(true)} />
          <NavRow label="Weights & Progression" onTap={() => setWeightsProgressionSheet(true)} />
          <NavRow label="Notifications" onTap={() => setNotificationsGroupSheet(true)} />
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setTrainingSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Training › Session ══ */}
      <SettingsSheet open={sessionBehaviourSheet} onClose={() => setSessionBehaviourSheet(false)} title="Session">
        <div>
          <Row label="Rest timers" first>
            <button style={accentBtn} onClick={() => setRestSheet(true)}>Change</button>
          </Row>
          <Row label="Auto-end session">
            <button style={accentBtn} onClick={() => setTimeoutSheet(true)}>
              {(store.settings?.sessionTimeoutMinutes ?? 90) !== 90 ? `${store.settings.sessionTimeoutMinutes} min` : 'Change'}
            </button>
          </Row>
          <Row label="Paceguard">
            {store.settings?.tempoEnabled
              ? <button style={accentBtn} onClick={() => setPaceguardSheet(true)}>Change</button>
              : <Toggle on={false} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, tempoEnabled: true } }))} />
            }
          </Row>
          <Row label="Warmup sets in summary">
            <Toggle on={showWarmupInSummary} onToggle={() => { const n = !showWarmupInSummary; setShowWarmupInSummary(n); setStore(s => ({ ...s, settings: { ...s.settings, showWarmupInSummary: n } })); }} />
          </Row>
          <Row label="Regression indicator">
            <Toggle on={store.settings?.showRegression !== false} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, showRegression: s.settings?.showRegression === false } }))} />
          </Row>
          <Row label="Pin all exercise notes">
            <Toggle on={!!store.settings?.pinAllNotes} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, pinAllNotes: !s.settings?.pinAllNotes } }))} />
          </Row>
          <div className="micro" style={{ color: UI.inkFaint, marginTop: 8, lineHeight: 1.5 }}>
            When on, every exercise note pops up on its first set of the session. When off, only notes you pin individually do.
          </div>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setSessionBehaviourSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Training › Weights & Progression ══ */}
      <SettingsSheet open={weightsProgressionSheet} onClose={() => setWeightsProgressionSheet(false)} title="Weights & Progression">
        <div>
          <Row label="Smart progression" first>
            {store.settings?.smartProgression
              ? <button style={accentBtn} onClick={() => setProgressionSheet(true)}>Change</button>
              : <Toggle on={false} onToggle={() => { setStore(s => ({ ...s, settings: { ...s.settings, smartProgression: true } })); setProgDisclaimer(true); }} />
            }
          </Row>
          <Row label="Equipment setup">
            <button style={accentBtn} onClick={() => setProgConfigOpen(true)}>Change</button>
          </Row>
          <Row label="Plate inventory">
            <button style={accentBtn} onClick={() => setPlateInventoryOpen(true)}>Change</button>
          </Row>
          <Row label="Fill weight down">
            <Toggle on={store.settings?.weightFillDown !== false} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, weightFillDown: s.settings?.weightFillDown === false } }))} />
          </Row>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setWeightsProgressionSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Training › Notifications ══ */}
      <SettingsSheet open={notificationsGroupSheet} onClose={() => setNotificationsGroupSheet(false)} title="Notifications">
        <div>
          <Row label="Remind on training days" first>
            {reminderEnabled
              ? <button style={accentBtn} onClick={() => setReminderSheet(true)}>{store.settings?.reminderTime || 'Change'}</button>
              : <Toggle on={false} onToggle={toggleReminder} />
            }
          </Row>
          {!pushEnabled && (
            <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
              Requires push notifications, toggling will open the push setup.
            </div>
          )}
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setNotificationsGroupSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Appearance Sheet ══ */}
      <SettingsSheet open={appearanceSheet} onClose={() => setAppearanceSheet(false)} title="Appearance">
        <div>
          <div className="micro" style={{ marginBottom: 10 }}>Accent color</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px 0', marginBottom: 14 }}>
            {Object.entries(window.ACCENT_PALETTE).map(([key, c]) => {
              const active = (store.settings?.accentColor ?? 'copper') === key;
              return (
                <button key={key} onClick={() => { window.applyAccentColor(key); try { localStorage.setItem('logbook-accent-color', key); } catch (_) {} setStore(s => ({ ...s, settings: { ...s.settings, accentColor: key } })); }}
                  title={c.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0, WebkitTapHighlightColor: 'transparent' }}>
                  <div style={{ width: active ? 32 : 26, height: active ? 32 : 26, borderRadius: '50%', background: c.hex, border: active ? `2.5px solid ${UI.ink}` : '2px solid transparent', boxShadow: active ? `0 0 0 1.5px ${c.hex}` : 'none', transition: 'all 0.18s' }} />
                  {active && <span style={{ fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: UI.fontUi, fontWeight: 600, color: 'var(--accent)' }}>{c.label}</span>}
                </button>
              );
            })}
          </div>
          <div className="knurl" style={{ marginBottom: 14 }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span className="micro">Watermark opacity</span>
            {store.settings?.watermarkOpacity != null && (
              <button onClick={() => {
                // Clears the explicit override so it falls back to the
                // per-theme/per-image default again (same formula the initial
                // slider position and screens-home.jsx's render both use).
                const def = store.settings?.vipBackground ? 16 : darkMode === 'paper' ? (gridEnabled ? 16 : 4) : darkMode === 'light' ? 14 : (gridEnabled ? 12 : 4);
                setWatermarkOpacityPct(def);
                setStore(s => ({ ...s, settings: { ...s.settings, watermarkOpacity: null } }));
              }} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                color: UI.gold, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600,
                letterSpacing: '0.1em', textTransform: 'uppercase', WebkitTapHighlightColor: 'transparent',
              }}>Reset</button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <input type="range" min="0" max="100" step="1" value={watermarkOpacityPct}
              onChange={e => {
                const v = +e.target.value;
                setWatermarkOpacityPct(v);
                setStore(s => ({ ...s, settings: { ...s.settings, watermarkOpacity: v } }));
              }}
              style={{ flex: 1, background: `linear-gradient(to right, var(--accent) ${watermarkOpacityPct}%, var(--range-track) ${watermarkOpacityPct}%)` }} />
            <span className="num" style={{ fontSize: 13, color: UI.inkSoft, minWidth: 32, textAlign: 'right' }}>{watermarkOpacityPct}%</span>
          </div>
          <div style={{ fontFamily: UI.fontUi, fontSize: 10.5, color: UI.inkFaint, marginBottom: 14, lineHeight: 1.4 }}>
            How visible the logo (or your VIP background) is behind the Home screen.
          </div>
          <Row label="Week view in cycle mode" first>
            <Toggle on={cycleWeekView} onToggle={() => { const n = !cycleWeekView; setCycleWeekView(n); try { localStorage.setItem('logbook-cycle-week-view', String(n)); } catch (_) {} setStore(s => ({ ...s, settings: { ...s.settings, cycleWeekView: n } })); }} />
          </Row>
          <Row label="Theme">
            <div style={{ display: 'flex', gap: 4 }}>
              {[['dark', 'Dark'], ['black', 'OLED'], ['light', 'Light'], ['paper', 'Paper']].map(([key, label]) => (
                <button key={key} onClick={() => { setDarkMode(key); try { localStorage.setItem('logbook-dark-mode', key); } catch (_) {} window.applyDarkMode(key); setStore(s => ({ ...s, settings: { ...s.settings, darkMode: key } })); }} style={{
                  padding: '6px 11px', borderRadius: 4, cursor: 'pointer',
                  background: darkMode === key ? UI.goldFaint : UI.bgInset,
                  border: `1px solid ${darkMode === key ? UI.goldSoft : UI.hairStrong}`,
                  color: darkMode === key ? UI.gold : UI.inkSoft,
                  fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                  textShadow: 'none',
                }}>{label}</button>
              ))}
            </div>
          </Row>
          <Row label="Grid">
            <Toggle on={gridEnabled} onToggle={() => {
              const n = !gridEnabled;
              setGridEnabled(n);
              window.applyGridPreference(n);
            }} />
          </Row>
          <Row label="Larger text">
            <Toggle on={largerText} onToggle={() => {
              const n = !largerText;
              setLargerText(n);
              try { localStorage.setItem('logbook-larger-text', String(n)); } catch (_) {}
              window.applyLargeTextPreference(n);
            }} />
          </Row>
          <div style={{ fontFamily: UI.fontUi, fontSize: 10.5, color: UI.inkFaint, margin: '-2px 0 8px', lineHeight: 1.4 }}>
            Increases text and controls on this device only.
          </div>
          <div className="knurl" />
          <div style={{ padding: '10px 0 4px' }}>
            <div className="micro" style={{ marginBottom: 5 }}>Touch layout</div>
            <div style={{ fontFamily: UI.fontUi, fontSize: 10.5, color: UI.inkFaint, lineHeight: 1.4 }}>
              Use this if buttons appear visibly correct but respond a little above or below where you tap.
            </div>
            <Btn kind="ghost" style={{ width: '100%', marginTop: 10 }} onClick={recalibrateViewport}>Recalibrate layout</Btn>
          </div>
          {darkMode === 'paper' && (
            <Row label="Full accent color in Paper">
              <Toggle on={paperAccentEnabled} onToggle={() => {
                const n = !paperAccentEnabled;
                setPaperAccentEnabled(n);
                try { localStorage.setItem('logbook-paper-accent-enabled', String(n)); } catch (_) {}
                window.applyAccentColor(store.settings?.accentColor || 'gold');
              }} />
            </Row>
          )}
          <Row label="Unit preference">
            <button style={accentBtn} onClick={() => setUnitPickerOpen(true)}>
              {store.settings?.unit === 'lbs' ? 'Imperial' : store.settings?.unit === 'mixed' ? 'Mixed' : 'Metric'}
            </button>
          </Row>
          <div style={{ marginTop: 24 }}>
            <Btn style={{ width: '100%' }} onClick={() => setAppearanceSheet(false)}>Done</Btn>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Data Sheet ══ */}
      <SettingsSheet open={dataSheet} onClose={() => setDataSheet(false)} title="Data">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <div className="label" style={{ color: UI.gold, marginBottom: 8 }}>BACKUP &amp; RESTORE</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                {/* backupOk is NOT reset here: it starts false and is only ever
                    set by exportData itself (true on success, false on failure),
                    so a backup already downloaded earlier this session still
                    counts, reopening this sheet shouldn't re-arm the "no backup
                    yet" warning under it for no reason. */}
                <Btn kind="ghost" onClick={() => exportData()} style={{ width: '100%' }}>Download full backup</Btn>
                <div className="micro" style={{ color: UI.inkFaint, margin: '5px 2px 0', lineHeight: 1.4 }}>
                  Save a complete copy of your Zane data to this device.
                </div>
              </div>
              <div>
                <Btn kind="ghost" onClick={() => setImportSheet(true)} disabled={importing} style={{ width: '100%' }}>{importing ? 'Restoring…' : 'Restore from backup'}</Btn>
                <div className="micro" style={{ color: UI.inkFaint, margin: '5px 2px 0', lineHeight: 1.4 }}>
                  Replace your current data with a previously saved backup.
                </div>
              </div>
            </div>
          </div>
          <div>
            <div className="label" style={{ color: UI.gold, marginBottom: 8 }}>SHARE OR ANALYSE TRAINING</div>
            <Btn kind="ghost" onClick={() => setTrainingExportSheet(true)} style={{ width: '100%' }}>Export workout history</Btn>
            <div className="micro" style={{ color: UI.inkFaint, margin: '5px 2px 0', lineHeight: 1.4 }}>
              Download your training history as CSV, Excel, or PDF.
            </div>
          </div>
          <div>
            <div className="label" style={{ color: UI.gold, marginBottom: 8 }}>MOVE TO ZANE</div>
            <Btn kind="ghost" onClick={() => setMigrationSheet(true)} style={{ width: '100%' }}>Migrate from other apps</Btn>
            <div className="micro" style={{ color: UI.inkFaint, margin: '5px 2px 0', lineHeight: 1.4 }}>
              Bring a workout history or training plan from another app.
            </div>
          </div>
          <div>
            <Btn kind="ghost" onClick={handleDeleteAll} style={{ width: '100%', color: UI.danger, background: 'rgba(var(--danger-rgb),0.08)', borderColor: 'rgba(var(--danger-rgb),calc(0.2 * var(--danger-border-boost)))' }}>Delete all data</Btn>
            <div className="micro" style={{ color: UI.inkFaint, margin: '5px 2px 0', lineHeight: 1.4 }}>
              Permanently remove all data from this account.
            </div>
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Migration picker ══ */}
      <SettingsSheet open={migrationSheet} onClose={() => setMigrationSheet(false)} title="Migrate from other apps">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ background: UI.bgInset, borderRadius: 6, padding: '12px 14px', lineHeight: 1.5, fontSize: 13, color: UI.inkSoft }}>
            Bring your training history or a training plan into Zane from a CSV or Excel file. The file is analysed first and nothing is saved until you review and confirm it.
          </div>
          <Btn kind="ghost" onClick={runPlanImport} style={{ width: '100%' }}>
            <i className="fa-solid fa-list-check" style={{ marginRight: 8 }} /> Import a training plan
          </Btn>
          <Btn kind="ghost" onClick={runWorkoutImport} style={{ width: '100%' }}>
            <i className="fa-solid fa-clock-rotate-left" style={{ marginRight: 8 }} /> Import workout history
          </Btn>
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.45 }}>
            Plans are added as a new flexible plan. Existing plans and history are never overwritten.
          </div>
        </div>
      </SettingsSheet>

      {/* ══ Export Training Sheet ══ */}
      <SettingsSheet open={trainingExportSheet} onClose={exportingTraining ? () => {} : () => setTrainingExportSheet(false)} title="Export Training">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <div className="label" style={{ color: UI.inkFaint, marginBottom: 8 }}>FORMAT</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { key: 'csv', label: 'CSV' },
                { key: 'xlsx', label: 'Excel' },
                { key: 'pdf', label: 'PDF' },
              ].map(f => (
                <button key={f.key} onClick={() => setExportFormat(f.key)} style={{
                  flex: 1, padding: '7px 4px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
                  background: exportFormat === f.key ? 'var(--accent)' : UI.bgInset,
                  color: exportFormat === f.key ? 'var(--accent-ink)' : UI.inkSoft,
                  textShadow: 'none',
                  fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}>{f.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="label" style={{ color: UI.inkFaint, marginBottom: 8 }}>TIME RANGE</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[
                { key: '7', label: '7 Days' },
                { key: '30', label: '30 Days' },
                { key: 'custom', label: 'Custom' },
                { key: 'all', label: 'All Time' },
              ].map(p => (
                <button key={p.key} onClick={() => setExportRange(p.key)} style={{
                  flex: 1, padding: '7px 4px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
                  background: exportRange === p.key ? 'var(--accent)' : UI.bgInset,
                  color: exportRange === p.key ? 'var(--accent-ink)' : UI.inkSoft,
                  textShadow: 'none',
                  fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                }}>{p.label}</button>
              ))}
            </div>
            {exportRange === 'custom' && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="label" style={{ color: UI.inkFaint, marginBottom: 4 }}>FROM</div>
                  <input type="date" value={exportFrom} max={exportTo}
                    onChange={e => e.target.value && setExportFrom(e.target.value)}
                    style={{
                      width: '100%', minWidth: 0, boxSizing: 'border-box', WebkitAppearance: 'none',
                      colorScheme: ['light', 'paper'].includes(store.settings?.darkMode ?? 'dark') ? 'light' : 'dark',
                      padding: '8px 10px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
                      background: UI.bgInset, color: UI.ink, fontFamily: UI.fontNum, fontSize: 13, outline: 'none',
                    }} />
                </div>
                <div style={{ color: UI.inkFaint, fontSize: 11, paddingTop: 16, flexShrink: 0 }}>→</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="label" style={{ color: UI.inkFaint, marginBottom: 4 }}>TO</div>
                  <input type="date" value={exportTo} min={exportFrom} max={LB.todayISO()}
                    onChange={e => e.target.value && setExportTo(e.target.value)}
                    style={{
                      width: '100%', minWidth: 0, boxSizing: 'border-box', WebkitAppearance: 'none',
                      colorScheme: ['light', 'paper'].includes(store.settings?.darkMode ?? 'dark') ? 'light' : 'dark',
                      padding: '8px 10px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`,
                      background: UI.bgInset, color: UI.ink, fontFamily: UI.fontNum, fontSize: 13, outline: 'none',
                    }} />
                </div>
              </div>
            )}
          </div>
          <Btn onClick={doExportTraining} disabled={exportingTraining} style={{ width: '100%' }}>
            {exportingTraining ? 'Exporting…' : `Export ${exportFormat.toUpperCase()}`}
          </Btn>
        </div>
      </SettingsSheet>

      {/* ══ Import Sheet ══ */}
      <SettingsSheet open={importSheet} onClose={importing ? () => {} : () => setImportSheet(false)} title="Restore backup">
        {importing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: UI.inkSoft, minHeight: 20 }}>{importProgress.phase}</div>
            <div style={{ background: UI.bgInset, borderRadius: 999, height: 6, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 999, background: 'var(--accent)', width: `${importProgress.pct}%`, transition: 'width 0.4s ease' }} />
            </div>
            <div className="num" style={{ fontSize: 11, color: UI.inkFaint, textAlign: 'right' }}>{importProgress.pct}%</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: UI.bgInset, borderRadius: 6, padding: '12px 14px', lineHeight: 1.55, fontSize: 13, color: UI.inkSoft }}>
              <span style={{ color: UI.ink, fontWeight: 600 }}>Step 1:</span> Download a backup of your current data first.{' '}
              <span style={{ color: UI.ink, fontWeight: 600 }}>Step 2:</span> Then pick the file you want to restore.
            </div>
            <Btn kind="ghost" onClick={() => exportData(`zane-before-import-${LB.todayISO()}.json`)}>
              {backupOk ? '1 · Backup downloaded ✓' : '1 · Backup current data'}
            </Btn>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
              <span style={{ fontSize: 12, color: UI.inkSoft }}>Source weight unit</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {['kg', 'lbs'].map(u => (
                  <button key={u} onClick={() => setImportSourceUnit(u)} style={{
                    padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    background: importSourceUnit === u ? 'var(--accent)' : UI.bgInset,
                    color: importSourceUnit === u ? 'var(--accent-ink)' : UI.inkSoft,
                    textShadow: 'none',
                  }}>{u.toUpperCase()}</button>
                ))}
              </div>
            </div>
            {!backupOk && (
              <div style={{ fontSize: 12, color: UI.gold, lineHeight: 1.5, padding: '0 2px' }}>
                No backup downloaded yet in this session. The restore replaces your data permanently, so do step 1 first.
              </div>
            )}
            <Btn kind="ghost" onClick={runImport}>2 · Select file and import</Btn>
          </div>
        )}
      </SettingsSheet>

      {/* ══ AI plan CSV/XLSX import ══ */}
      <SettingsSheet open={planImportSheet} onClose={planImportSaving ? () => {} : closePlanImport} title="Import a training plan">
        {planImportLoading || planImportSaving ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
              <div style={{ color: UI.inkSoft, fontSize: 13, minHeight: 20 }}>{planImportProgress.phase || (planImportSaving ? 'Importing your plan…' : 'Reading the plan…')}</div>
              <div className="num" style={{ color: UI.inkFaint, fontSize: 12, flexShrink: 0 }}>{planImportProgress.pct}%</div>
            </div>
            <div role="progressbar" aria-label="Training plan import progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={planImportProgress.pct} style={{ background: UI.bgInset, borderRadius: 999, height: 8, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hair}` }}>
              <div style={{ height: '100%', borderRadius: 999, background: 'var(--accent)', width: `${planImportProgress.pct}%`, transition: 'width 0.45s ease' }} />
            </div>
            <div className="micro" style={{ color: UI.inkFaint }}>{planImportSaving ? 'Keep this sheet open while Zane saves the plan.' : 'Qwen prepares a preview. Your existing plans are not changed.'}</div>
          </div>
        ) : planImportError && !planImportPreview ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ color: UI.danger, fontSize: 13, lineHeight: 1.5 }}>{planImportError}</div>
            <Btn kind="ghost" onClick={closePlanImport}>Close</Btn>
          </div>
        ) : planImportPreview ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
              {['DETECTED', 'PLAN PREVIEW', 'REVIEW'].map((label, index) => {
                const step = index + 1;
                const active = planImportStep === step;
                const completed = planImportStep > step;
                return <button key={label} onClick={() => completed && setPlanImportStep(step)} disabled={!completed && !active} style={{ minWidth: 0, padding: '7px 3px', borderRadius: 4, border: `var(--hair-width) solid ${active || completed ? 'var(--accent)' : UI.hair}`, background: active ? 'var(--accent)' : UI.bgInset, color: active ? 'var(--accent-ink)' : completed ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', cursor: completed ? 'pointer' : 'default', textShadow: 'none' }}><span style={{ display: 'block', fontSize: 9, marginBottom: 2 }}>{completed ? '✓' : step}</span>{label}</button>;
              })}
            </div>
            {planImportStep === 1 && (
              <>
                <div style={{ background: UI.bgInset, borderRadius: 6, padding: '12px 14px', lineHeight: 1.5, fontSize: 13, color: UI.inkSoft }}>
                  <div style={{ color: UI.ink, fontWeight: 600, marginBottom: 5 }}>Step 1 · Detected</div>
                  <span style={{ color: UI.ink }}>{planImportPreview.planName}</span><br />
                  {planImportPreview.stats.days} training days · {planImportPreview.stats.exercises} exercises found. Nothing is saved yet.
                </div>
                <div>
                  <div className="label" style={{ color: UI.inkFaint, marginBottom: 7 }}>WHAT ZANE DETECTED</div>
                  <div style={{ background: UI.bgInset, borderRadius: 6, padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {Object.entries(planImportPreview.mapping?.columns || {}).filter(([, header]) => header).map(([field, header]) => (
                      <div key={field} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: UI.inkSoft, fontSize: 12 }}>
                        <span style={{ color: UI.inkFaint, textTransform: 'capitalize' }}>{field.replace(/([A-Z])/g, ' $1')}</span>
                        <span style={{ color: UI.ink, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{header}</span>
                      </div>
                    ))}
                    <div style={{ color: UI.inkFaint, fontSize: 11, marginTop: 2 }}>
                      {planImportPreview.mapping?.exerciseMappings?.filter(x => x.existingName).length || 0} exercise name{(planImportPreview.mapping?.exerciseMappings?.filter(x => x.existingName).length || 0) === 1 ? '' : 's'} matched to your library.
                    </div>
                  </div>
                </div>
                {planImportPreview.stats.invalidRows > 0 && <div className="micro" style={{ color: UI.gold }}>{planImportPreview.stats.invalidRows} row{planImportPreview.stats.invalidRows === 1 ? '' : 's'} had no usable exercise and will be skipped.</div>}
                {planImportPreview.mapping?.warnings?.length > 0 && <div className="micro" style={{ color: UI.gold, lineHeight: 1.45 }}>{planImportPreview.mapping.warnings.join(' ')}</div>}
                <Btn onClick={() => setPlanImportStep(2)} disabled={!planImportPreview.days.length} style={{ width: '100%' }}>See the plan preview</Btn>
                <Btn kind="ghost" onClick={closePlanImport}>Cancel</Btn>
              </>
            )}
            {planImportStep === 2 && (
              <>
                <div style={{ background: UI.bgInset, borderRadius: 6, padding: '12px 14px', lineHeight: 1.45 }}>
                  <div className="label" style={{ color: UI.gold, marginBottom: 5 }}>STEP 2 · PLAN PREVIEW</div>
                  <div style={{ color: UI.ink, fontSize: 17, fontWeight: 600, fontFamily: UI.fontUi }}>{planImportSampleDay?.name || 'Training day'}</div>
                  <div className="micro" style={{ color: UI.inkFaint, marginTop: 3 }}>Day {Math.min(planImportDayIndex + 1, planImportDays.length)} of {planImportDays.length} · {planImportPreview.planName}</div>
                </div>
                {planImportSampleDay ? (
                  <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {planImportSampleDay.items.map((item, itemIndex) => (
                      <div key={`${item.name}-${itemIndex}`} style={{ background: UI.bgInset, borderRadius: 5, padding: '10px 11px', borderLeft: `2px solid ${UI.gold}`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                        <span style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                        <span className="num" style={{ color: UI.inkSoft, fontSize: 12, flexShrink: 0 }}>{planImportFormatItem(item)}</span>
                      </div>
                    ))}
                  </div>
                ) : <div className="micro" style={{ color: UI.inkFaint }}>No training day rows were found.</div>}
                {planImportDays.length > 1 && <div style={{ display: 'flex', gap: 7 }}>
                  <Btn kind="ghost" disabled={planImportDayIndex <= 0} onClick={() => setPlanImportDayIndex(i => Math.max(0, i - 1))} style={{ flex: 1 }}>Previous day</Btn>
                  <Btn kind="ghost" disabled={planImportDayIndex >= planImportDays.length - 1} onClick={() => setPlanImportDayIndex(i => Math.min(planImportDays.length - 1, i + 1))} style={{ flex: 1 }}>Next day</Btn>
                </div>}
                <Btn onClick={() => setPlanImportStep(3)} style={{ width: '100%' }}>Continue to review</Btn>
                <Btn kind="ghost" onClick={() => setPlanImportStep(1)}>Back</Btn>
              </>
            )}
            {planImportStep === 3 && (
              <>
                <div style={{ background: UI.bgInset, borderRadius: 6, padding: '12px 14px', lineHeight: 1.55, fontSize: 13, color: UI.inkSoft }}>
                  <div style={{ color: UI.ink, fontWeight: 600, marginBottom: 5 }}>Step 3 · Review and import</div>
                  <span style={{ color: UI.ink }}>{planImportPreview.planName}</span> will be added as a new flexible plan with {planImportPreview.stats.days} days.
                </div>
                <div>
                  <div className="label" style={{ color: UI.inkFaint, marginBottom: 7 }}>EXERCISE NAMES</div>
                  {planImportPreview.unknownExercises.length === 0 ? (
                    <div className="micro" style={{ color: UI.ok }}>All exercises match your library.</div>
                  ) : <>
                    <div className="micro" style={{ color: UI.inkFaint, marginBottom: 7 }}>{planImportPreview.unknownExercises.length} exercise name{planImportPreview.unknownExercises.length === 1 ? '' : 's'} are new. They will be created as private exercises so the imported plan is usable immediately.</div>
                    <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {planImportPreview.unknownExercises.slice(0, 30).map(x => <div key={x.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: UI.inkSoft, fontSize: 12, fontFamily: UI.fontUi }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span><span className="num" style={{ color: UI.inkFaint, flexShrink: 0 }}>{x.days} day{x.days === 1 ? '' : 's'}</span></div>)}
                      {planImportPreview.unknownExercises.length > 30 && <div className="micro" style={{ color: UI.inkFaint }}>+ {planImportPreview.unknownExercises.length - 30} more</div>}
                    </div>
                  </>}
                </div>
                {planImportError && <div style={{ color: UI.danger, fontSize: 12 }}>{planImportError}</div>}
                <Btn onClick={commitPlanImport} disabled={planImportSaving || !planImportPreview.days.length} style={{ width: '100%' }}>{planImportSaving ? 'Importing...' : `Import ${planImportPreview.planName}`}</Btn>
                <Btn kind="ghost" onClick={() => setPlanImportStep(2)}>Back to plan preview</Btn>
                <Btn kind="ghost" onClick={closePlanImport}>Cancel</Btn>
              </>
            )}
          </div>
        ) : null}
      </SettingsSheet>

      {/* ══ AI workout CSV/XLSX import ══ */}
      <SettingsSheet open={workoutImportSheet} onClose={workoutImportSaving ? () => {} : closeWorkoutImport} title="Import workout history">
        {workoutImportLoading || workoutImportSaving ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
              <div style={{ color: UI.inkSoft, fontSize: 13, minHeight: 20 }}>{workoutImportProgress.phase || (workoutImportSaving ? 'Importing your history…' : 'Reading the file…')}</div>
              <div className="num" style={{ color: UI.inkFaint, fontSize: 12, flexShrink: 0 }}>{workoutImportProgress.pct}%</div>
            </div>
            <div role="progressbar" aria-label="Workout import progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={workoutImportProgress.pct} style={{ background: UI.bgInset, borderRadius: 999, height: 8, overflow: 'hidden', border: `var(--hair-width) solid ${UI.hair}` }}>
              <div style={{ height: '100%', borderRadius: 999, background: 'var(--accent)', width: `${workoutImportProgress.pct}%`, transition: 'width 0.45s ease' }} />
            </div>
            <div className="micro" style={{ color: UI.inkFaint }}>{workoutImportSaving ? 'Keep this sheet open while Zane saves the workouts and sets.' : 'Zane analyses the file and prepares a preview. Nothing is saved during this step.'}</div>
          </div>
        ) : workoutImportError && !workoutImportPreview ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ color: UI.danger, fontSize: 13, lineHeight: 1.5 }}>{workoutImportError}</div>
            <Btn kind="ghost" onClick={closeWorkoutImport}>Close</Btn>
          </div>
        ) : workoutImportPreview ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
              {['DETECTED', 'WORKOUT', 'REVIEW'].map((label, index) => {
                const step = index + 1;
                const active = workoutImportStep === step;
                const completed = workoutImportStep > step;
                return <button key={label} onClick={() => completed && setWorkoutImportStep(step)} disabled={!completed && !active} style={{ minWidth: 0, padding: '7px 3px', borderRadius: 4, border: `var(--hair-width) solid ${active || completed ? 'var(--accent)' : UI.hair}`, background: active ? 'var(--accent)' : UI.bgInset, color: active ? 'var(--accent-ink)' : completed ? UI.gold : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', cursor: completed ? 'pointer' : 'default', textShadow: 'none' }}><span style={{ display: 'block', fontSize: 9, marginBottom: 2 }}>{completed ? '✓' : step}</span>{label}</button>;
              })}
            </div>

            {workoutImportStep === 1 && (
              <>
                <div style={{ background: UI.bgInset, borderRadius: 6, padding: '12px 14px', lineHeight: 1.55, fontSize: 13, color: UI.inkSoft }}>
                  <div style={{ color: UI.ink, fontWeight: 600, marginBottom: 5 }}>Step 1 · Detected</div>
                  {workoutImportPreview.stats.sessions} workouts · {workoutImportPreview.stats.sets} sets found. Nothing is saved yet.
                </div>
                <div>
                  <div className="label" style={{ color: UI.inkFaint, marginBottom: 7 }}>WHAT ZANE DETECTED</div>
                  <div style={{ background: UI.bgInset, borderRadius: 6, padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {Object.entries(workoutImportPreview.mapping?.columns || {}).filter(([, header]) => header).map(([field, header]) => (
                      <div key={field} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: UI.inkSoft, fontSize: 12 }}>
                        <span style={{ color: UI.inkFaint, textTransform: 'capitalize' }}>{field.replace(/([A-Z])/g, ' $1')}</span>
                        <span style={{ color: UI.ink, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{header}</span>
                      </div>
                    ))}
                    <div style={{ color: UI.inkFaint, fontSize: 11, marginTop: 2 }}>
                      {workoutImportPreview.mapping?.exerciseMappings?.filter(x => x.existingName).length || 0} exercise name{(workoutImportPreview.mapping?.exerciseMappings?.filter(x => x.existingName).length || 0) === 1 ? '' : 's'} matched to your library.
                    </div>
                  </div>
                </div>
                {workoutImportPreview.stats.invalidRows > 0 && <div className="micro" style={{ color: UI.gold }}>{workoutImportPreview.stats.invalidRows} row{workoutImportPreview.stats.invalidRows === 1 ? '' : 's'} had no usable date or completed value and will be skipped.</div>}
                {workoutImportPreview.mapping?.warnings?.length > 0 && <div className="micro" style={{ color: UI.gold, lineHeight: 1.45 }}>{workoutImportPreview.mapping.warnings.join(' ')}</div>}
                <Btn onClick={() => setWorkoutImportStep(2)} disabled={!workoutImportPreview.sessions.length} style={{ width: '100%' }}>See a workout preview</Btn>
                <Btn kind="ghost" onClick={closeWorkoutImport}>Cancel</Btn>
              </>
            )}

            {workoutImportStep === 2 && (
              <>
                <div style={{ background: UI.bgInset, borderRadius: 6, padding: '12px 14px', lineHeight: 1.45 }}>
                  <div className="label" style={{ color: UI.gold, marginBottom: 5 }}>STEP 2 · WORKOUT PREVIEW</div>
                  <div style={{ color: UI.ink, fontSize: 17, fontWeight: 600, fontFamily: UI.fontUi }}>{workoutImportSample?.dayName || 'Imported workout'}</div>
                  <div className="micro" style={{ color: UI.inkFaint, marginTop: 3 }}>{workoutImportSample?.date || 'Unknown date'} · workout {Math.min(workoutImportPreviewIndex + 1, workoutImportSessions.length)} of {workoutImportSessions.length}</div>
                </div>
                {workoutImportSample ? (
                  <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {workoutImportSample.entries.map((entry, entryIndex) => (
                      <div key={`${entry.name}-${entryIndex}`} style={{ background: UI.bgInset, borderRadius: 5, padding: '9px 11px', borderLeft: `2px solid ${UI.gold}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', marginBottom: 5 }}>
                          <span style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                          <span className="micro" style={{ color: UI.inkFaint, flexShrink: 0 }}>{entry.sets.length} set{entry.sets.length === 1 ? '' : 's'}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {entry.sets.map((set, setIndex) => <div key={setIndex} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: UI.inkSoft, fontSize: 12 }}><span className="micro" style={{ color: UI.inkFaint }}>SET {setIndex + 1}</span><span className="num" style={{ textAlign: 'right' }}>{workoutImportFormatSet(set)}</span></div>)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <div className="micro" style={{ color: UI.inkFaint }}>No workout rows were found.</div>}
                {workoutImportSessions.length > 1 && <div style={{ display: 'flex', gap: 7 }}>
                  <Btn kind="ghost" disabled={workoutImportPreviewIndex <= 0} onClick={() => setWorkoutImportPreviewIndex(i => Math.max(0, i - 1))} style={{ flex: 1 }}>Previous</Btn>
                  <Btn kind="ghost" disabled={workoutImportPreviewIndex >= workoutImportSessions.length - 1} onClick={() => setWorkoutImportPreviewIndex(i => Math.min(workoutImportSessions.length - 1, i + 1))} style={{ flex: 1 }}>Next</Btn>
                </div>}
                <Btn onClick={() => setWorkoutImportStep(3)} style={{ width: '100%' }}>Continue to review</Btn>
                <Btn kind="ghost" onClick={() => setWorkoutImportStep(1)}>Back</Btn>
              </>
            )}

            {workoutImportStep === 3 && (
              <>
                <div style={{ background: UI.bgInset, borderRadius: 6, padding: '12px 14px', lineHeight: 1.55, fontSize: 13, color: UI.inkSoft }}>
                  <div style={{ color: UI.ink, fontWeight: 600, marginBottom: 5 }}>Step 3 · Review and import</div>
                  {workoutImportPreview.stats.sessions} workouts will be checked for duplicates before anything is written.
                </div>
                <div>
                  <div className="label" style={{ color: UI.inkFaint, marginBottom: 7 }}>DUPLICATES</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[['skip', 'Skip exact duplicates'], ['import', 'Import anyway']].map(([key, label]) => (
                      <button key={key} onClick={() => setWorkoutImportDuplicateMode(key)} style={{ flex: 1, padding: '8px 6px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: workoutImportDuplicateMode === key ? 'var(--accent)' : UI.bgInset, color: workoutImportDuplicateMode === key ? 'var(--accent-ink)' : UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, cursor: 'pointer', textShadow: 'none' }}>{label}</button>
                    ))}
                  </div>
                  <div className="micro" style={{ marginTop: 5, color: UI.inkFaint }}>{workoutImportPreview.stats.duplicates} exact duplicate workout{workoutImportPreview.stats.duplicates === 1 ? '' : 's'} found.</div>
                </div>
                <div>
                  <div className="label" style={{ color: UI.inkFaint, marginBottom: 7 }}>UNKNOWN EXERCISES</div>
                  {workoutImportPreview.unknownExercises.length === 0 ? (
                    <div className="micro" style={{ color: UI.ok }}>All exercises match your library.</div>
                  ) : <>
                    <div className="micro" style={{ color: UI.inkFaint, marginBottom: 7 }}>{workoutImportPreview.unknownExercises.length} unique names are not in your library. We group them, so a long history does not create a one-by-one chore.</div>
                    <div style={{ maxHeight: 120, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                      {workoutImportPreview.unknownExercises.slice(0, 30).map(x => <div key={x.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: UI.inkSoft, fontSize: 12, fontFamily: UI.fontUi }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span><span className="num" style={{ color: UI.inkFaint, flexShrink: 0 }}>{x.count} sets</span></div>)}
                      {workoutImportPreview.unknownExercises.length > 30 && <div className="micro" style={{ color: UI.inkFaint }}>+ {workoutImportPreview.unknownExercises.length - 30} more</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {[['create', 'Create private exercises'], ['text', 'Keep as text']].map(([key, label]) => (
                        <button key={key} onClick={() => setWorkoutImportUnknownMode(key)} style={{ flex: 1, padding: '8px 6px', borderRadius: 4, border: `var(--hair-width) solid ${UI.hairStrong}`, background: workoutImportUnknownMode === key ? 'var(--accent)' : UI.bgInset, color: workoutImportUnknownMode === key ? 'var(--accent-ink)' : UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, cursor: 'pointer', textShadow: 'none' }}>{label}</button>
                      ))}
                    </div>
                  </>}
                </div>
                {workoutImportError && <div style={{ color: UI.danger, fontSize: 12 }}>{workoutImportError}</div>}
                <Btn onClick={commitWorkoutImport} disabled={workoutImportSaving || !workoutImportPreview.sessions.length || (workoutImportDuplicateMode === 'skip' && workoutImportPreview.sessions.length <= workoutImportPreview.stats.duplicates)} style={{ width: '100%' }}>{workoutImportSaving ? 'Importing...' : (() => { const count = workoutImportPreview.sessions.length - (workoutImportDuplicateMode === 'skip' ? workoutImportPreview.stats.duplicates : 0); return count ? `Import ${count} workouts` : 'Nothing new to import'; })()}</Btn>
                <Btn kind="ghost" onClick={() => setWorkoutImportStep(2)}>Back to workout preview</Btn>
                <Btn kind="ghost" onClick={closeWorkoutImport}>Cancel</Btn>
              </>
            )}
          </div>
        ) : null}
      </SettingsSheet>

      {/* ══ How To Sheet ══ */}
      <HowToSheet open={howToSheet} onClose={() => setHowToSheet(false)} />

      {/* ══ Changelog Sheet ══ */}
      <ChangelogSheet open={changelogSheet} onClose={() => setChangelogSheet(false)} />

      {/* ══ Unit picker modal ══ */}
      {unitPickerOpen && window.Screens?.UnitPromptModal && (
        <window.Screens.UnitPromptModal
          onDone={(chosenUnit) => {
            setUnitPickerOpen(false);
            // Mixed = kg weight + mi distance; sync the cardio dist key so
            // all cardio screens immediately reflect the chosen distance unit.
            const distUnit = chosenUnit === 'lbs' ? 'mi' : chosenUnit === 'mixed' ? 'mi' : 'km';
            LB.setCardioDistUnit(distUnit);
            setStore(s => s ? { ...s, settings: { ...s.settings, unit: chosenUnit } } : s);
          }}
        />
      )}

      {/* ══ Auto-end session sheet ══ */}
      <SettingsSheet open={timeoutSheet} onClose={() => setTimeoutSheet(false)} title="Auto-end session">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 8 }}>
          <div>
            <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>INACTIVITY TIMEOUT</div>
            <Stepper value={store.settings?.sessionTimeoutMinutes ?? 90} step={15} min={15} max={480} suffix=" min"
              onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, sessionTimeoutMinutes: v } }))} />
          </div>
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>
            Open sessions with no new sets for this long are automatically ended. Sessions with no sets at all are silently deleted.
          </div>
          <Btn onClick={() => setTimeoutSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Rest timers sheet ══ */}
      <SettingsSheet open={restSheet} onClose={() => setRestSheet(false)} title="Rest timers">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            {[['Default', 'restDefault', 120], ['Big', 'restBig', 180], ['Medium', 'restMedium', 120], ['Small', 'restSmall', 90]].map(([label, key, def]) => (
              <div key={key}>
                <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>{label.toUpperCase()}</div>
                <Stepper value={store.settings?.[key] ?? def} step={15} min={0} suffix="s"
                  onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, [key]: v } }))} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row label="Open rest timer automatically" first>
              <Toggle on={!!store.settings?.autoOpenRestTimer} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, autoOpenRestTimer: !s.settings?.autoOpenRestTimer } }))} />
            </Row>
            <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>
              Open the rest sheet as soon as a rest starts after a completed set. Off by default.
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', background: UI.bgRaised, borderRadius: 6, border: `1px solid ${UI.hairStrong}` }}>
            {[['BIG', 'Heavy compounds, squat, deadlift, overhead press'], ['MEDIUM', 'Moderate compounds, bench, pull-up, lunge'], ['SMALL', 'Isolation, bicep curl, lateral raise, tricep extension']].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span className="micro" style={{ color: UI.gold, flexShrink: 0, minWidth: 46 }}>{k}</span>
                <span className="micro" style={{ color: UI.inkSoft, letterSpacing: '0.04em', textTransform: 'none', fontWeight: 400 }}>{v}</span>
              </div>
            ))}
            <div style={{ marginTop: 4, borderTop: `1px solid ${UI.hair}`, paddingTop: 6 }}>
              <span className="micro" style={{ color: UI.inkFaint, letterSpacing: '0.04em', textTransform: 'none', fontWeight: 400, lineHeight: 1.5 }}>
                BIG / MEDIUM / SMALL only apply when the exercise has its size set. Default is used otherwise.
              </span>
            </div>
          </div>
          <Btn onClick={() => setRestSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Paceguard sheet ══ */}
      <SettingsSheet open={paceguardSheet} onClose={() => setPaceguardSheet(false)} title="Paceguard">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <Row label="Enabled" first>
            <Toggle on={!!store.settings?.tempoEnabled} onToggle={() => setStore(s => ({ ...s, settings: { ...s.settings, tempoEnabled: !s.settings?.tempoEnabled } }))} />
          </Row>
          {store.settings?.tempoEnabled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, paddingTop: 4 }}>
              <div>
                <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>ECCENTRIC (DOWN)</div>
                <Stepper value={store.settings?.tempoEccentric ?? 4} step={0.5} min={0.5} max={10} suffix="s" onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, tempoEccentric: v } }))} />
              </div>
              <div>
                <div className="micro" style={{ textAlign: 'center', marginBottom: 8 }}>CONCENTRIC (UP)</div>
                <Stepper value={store.settings?.tempoConcentric ?? 1} step={0.5} min={0.5} max={10} suffix="s" onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, tempoConcentric: v } }))} />
              </div>
            </div>
          )}
          <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>Beeps subdivide each phase evenly · count increases each beat</div>
          <Btn onClick={() => setPaceguardSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Smart progression sheet ══ */}
      <SettingsSheet open={progressionSheet} onClose={() => setProgressionSheet(false)} title="Smart progression">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <Row label="Enabled" first>
            <Toggle on={!!store.settings?.smartProgression} onToggle={() => { const t = !store.settings?.smartProgression; setStore(s => ({ ...s, settings: { ...s.settings, smartProgression: t } })); if (t) setProgDisclaimer(true); }} />
          </Row>
          {store.settings?.smartProgression && (
            <>
              <div>
                <div className="micro" style={{ marginBottom: 8 }}>REP RANGE TOP (+reps above target)</div>
                <Stepper value={store.settings?.progressionRangeTop ?? 4} step={1} min={1} max={10} suffix=" reps" onChange={v => setStore(s => ({ ...s, settings: { ...s.settings, progressionRangeTop: v } }))} />
              </div>
              <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>If target is 8 reps and range top is +4, weight increases only when all sets reach 12 reps. Works the same with per-set rep targets, each set uses its own threshold.</div>
            </>
          )}
          <Btn onClick={() => setProgressionSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Equipment config sheet ══ */}
      <SettingsSheet open={progConfigOpen} onClose={() => setProgConfigOpen(false)} title="Equipment setup">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 72px', gap: 8, padding: '0 4px 8px', borderBottom: `var(--hair-width) solid ${UI.hair}` }}>
            <span className="micro">Equipment</span>
            <span className="micro" style={{ textAlign: 'center' }}>Increment</span>
            <span className="micro" style={{ textAlign: 'center' }}>Max {UI.unit()}</span>
          </div>
          {(window.EQUIPMENT_TYPES || []).filter(({ key }) => key !== 'no_equipment' && key !== 'bodyweight').map(({ key, label }) => {
            const cfg = store.settings?.equipmentConfig?.[key] ?? {};
            const setField = (field, val) => setStore(s => ({ ...s, settings: { ...s.settings, equipmentConfig: { ...s.settings?.equipmentConfig, [key]: { ...(s.settings?.equipmentConfig?.[key] ?? {}), [field]: val } } } }));
            return (
              <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 72px', gap: 8, alignItems: 'center', padding: '10px 4px', borderBottom: `var(--hair-width) solid ${UI.hair}` }}>
                <span style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi }}>{label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: UI.bgInset, borderRadius: 4, padding: '6px 8px', border: `1px solid ${UI.hair}` }}>
                  <NumInput value={cfg.increment ?? null} placeholder="Default" onChange={v => setField('increment', v)} style={{ fontSize: 13, width: '100%' }} positiveOnly />
                  <span className="micro" style={{ flexShrink: 0 }}>{UI.unit()}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: UI.bgInset, borderRadius: 4, padding: '6px 8px', border: `1px solid ${UI.hair}` }}>
                  <NumInput value={cfg.maxKg ?? null} placeholder="Default" onChange={v => setField('maxKg', v)} style={{ fontSize: 13, width: '100%' }} />
                  <span className="micro" style={{ flexShrink: 0 }}>{UI.unit()}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.6, marginBottom: 16 }}>Set equipment categories on exercises in the exercise library. Need one exercise to step differently from the rest of its category? Set a Progression increment on that exercise's Edit screen to override this.</div>
        <Btn style={{ width: '100%' }} onClick={() => setProgConfigOpen(false)}>Done</Btn>
      </SettingsSheet>

      {/* ══ Plate inventory sheet ══ */}
      <SettingsSheet open={plateInventoryOpen} onClose={() => setPlateInventoryOpen(false)} title="Plate inventory">
        <div style={{ display: 'flex', gap: 3, marginBottom: 28, background: UI.bgInset, borderRadius: 4, padding: 3 }}>
          {['kg', 'lbs'].map((u, i) => (
            <button key={u} onClick={() => setPlateInvTab(i)} style={{
              flex: 1, padding: '8px 0', borderRadius: 4, border: 'none', cursor: 'pointer',
              background: plateInvTab === i ? 'var(--accent)' : 'transparent',
              color: plateInvTab === i ? 'var(--accent-ink)' : UI.inkFaint,
              fontFamily: UI.fontUi, fontSize: 12, letterSpacing: '0.06em',
              fontWeight: plateInvTab === i ? 600 : 400, transition: 'all 0.15s',
              textShadow: 'none',
            }}>{u.toUpperCase()}</button>
          ))}
        </div>
        {(() => {
          const isLbs = plateInvTab === 1;
          const invKey = isLbs ? 'plateInventoryLbs' : 'plateInventoryKg';
          const allPlates = isLbs ? PLATES_LBS : PLATES_KG;
          const plateColors = isLbs ? PLATE_COLORS_LBS : PLATE_COLORS_KG;
          const plateSizes  = isLbs ? PLATE_SIZE_LBS   : PLATE_SIZE_KG;
          const current = store.settings?.equipmentConfig?.[invKey] ?? allPlates;
          const toggle = (p) => {
            // The plate calculator's correction math indexes the smallest
            // available plate (plateSet[plateSet.length - 1]), an empty
            // inventory turns that into NaN throughout. Refuse to deselect
            // the last remaining plate instead of allowing an empty set.
            if (current.includes(p) && current.length <= 1) return;
            const newInv = current.includes(p)
              ? current.filter(x => x !== p)
              : [...current, p].sort((a, b) => b - a);
            setStore(s => ({ ...s, settings: { ...s.settings, equipmentConfig: { ...s.settings?.equipmentConfig, [invKey]: newInv } } }));
          };
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, justifyContent: 'center', alignItems: 'flex-end', padding: '4px 0 24px' }}>
              {allPlates.map(p => {
                const has = current.includes(p);
                const size = Math.round((plateSizes[p] || 32) * 0.75);
                const hole = Math.round(size * 0.3);
                const color = plateColors[p] || '#808b96';
                return (
                  <div key={p} onClick={() => toggle(p)} style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    cursor: 'pointer', opacity: has ? 1 : 0.22, transition: 'opacity 0.18s',
                    WebkitTapHighlightColor: 'transparent',
                  }}>
                    <div style={{
                      width: size, height: size, borderRadius: '50%',
                      background: color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      position: 'relative',
                      boxShadow: has ? `0 4px 14px rgba(0,0,0,0.45), 0 0 0 1.5px rgba(255,255,255,0.15)` : 'none',
                    }}>
                      <div style={{
                        position: 'absolute',
                        width: hole, height: hole, borderRadius: '50%',
                        background: 'var(--bg)',
                      }} />
                    </div>
                    <span style={{ fontFamily: UI.fontNum, fontSize: 11, color: UI.inkSoft, letterSpacing: '0.02em' }}>{p}</span>
                  </div>
                );
              })}
            </div>
          );
        })()}
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', lineHeight: 1.6, marginBottom: 20 }}>
          Tap a plate to toggle. Dimmed plates are not in your inventory and won't be suggested by the plate calculator.
        </div>
        <Btn style={{ width: '100%' }} onClick={() => setPlateInventoryOpen(false)}>Done</Btn>
      </SettingsSheet>

      {/* ══ Progression disclaimer sheet ══ */}
      <SettingsSheet open={progDisclaimer} onClose={() => setProgDisclaimer(false)} title="Smart Progression">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
          <div style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, lineHeight: 1.6 }}>The reps shown in your sets are <span style={{ color: UI.gold }}>minimum reps</span>, the floor the algorithm needs to track progression.</div>
          <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6 }}>Always train past that number. Push to failure or near-failure on each set. The algo only bumps weight when <em>all</em> sets hit the top of the range, so getting extra reps is how you earn the next weight.</div>
        </div>
        <Btn style={{ width: '100%', justifyContent: 'center' }} onClick={() => { setProgDisclaimer(false); setProgressionSheet(true); }}>Got it</Btn>
      </SettingsSheet>

      {/* ══ Admin sheet ══ */}
      <SettingsSheet open={adminSheet} onClose={() => setAdminSheet(false)} title={'Admin'}>
        {(() => {
          const unseenCount = allUsers.filter(isNewSignup).length;
          const adminUnread = supportInbox.reduce((sum, t) => sum + Number(t.unread_count || 0), 0);
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Frame style={{ padding: '0 14px' }}>
                <NavRow label="All users" first hint={unseenCount > 0 ? `${unseenCount} new` : (allUsers.length ? `${allUsers.length}` : undefined)} onTap={() => setAllUsersSheet(true)} />
                <NavRow label="VIP backgrounds" hint={vipBgList.length > 0 ? `${vipBgList.length} assigned` : 'None'} onTap={() => { setVipBgMsg(null); setVipBgSheet(true); }} />
                <NavRow label="Message all users" onTap={() => { setBroadcastMsg(null); setBroadcastSheet(true); }} />
                <NavRow label="Database stability" hint={runtimeConfig?.socialMode === 'maintenance' ? 'Friends paused' : (runtimeConfig?.socialTransport === 'broadcast' && runtimeConfig?.coachingTransport === 'broadcast' ? 'Broadcast' : 'Mixed')} onTap={() => { setDbStabilityMsg(null); setDbStabilitySheet(true); }} />
                <NavRow label="Update tools" onTap={() => setUpdateToolsSheet(true)} />
              </Frame>
              <div style={{ borderTop: `var(--hair-width) solid ${UI.hair}`, paddingTop: 16 }}>
                <Btn onClick={() => setSupportInboxSheet(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', fontSize: 15, padding: '14px 16px' }}>
                  Support inbox
                  {adminUnread > 0 && (
                    <span style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 999, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>{adminUnread}</span>
                  )}
                </Btn>
              </div>
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Message all users (admin) ══ */}
      <SettingsSheet open={dbStabilitySheet} onClose={() => setDbStabilitySheet(false)} title="Database Stability">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.55 }}>
            The emergency switch stops all Friends reads, polls and channels. Use it first when database pressure rises. Training and login are unaffected.
          </div>
          <Frame style={{ padding: '0 14px' }}>
            <NavRow label="Social mode" first hint={runtimeConfig?.socialMode === 'maintenance' ? 'Maintenance' : 'Normal'} />
            <NavRow label="Social transport" hint={runtimeConfig?.socialTransport === 'broadcast' ? 'Broadcast' : 'Legacy'} />
            <NavRow label="Coaching transport" hint={runtimeConfig?.coachingTransport === 'broadcast' ? 'Broadcast' : 'Legacy'} />
          </Frame>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Btn kind="ghost" onClick={() => setSocialMode('maintenance')} disabled={socialModeBusy || runtimeConfig?.socialMode === 'maintenance'}>Pause Friends</Btn>
            <Btn onClick={() => setSocialMode('normal')} disabled={socialModeBusy || runtimeConfig?.socialMode === 'normal'}>Resume Friends</Btn>
          </div>
          <div style={{ borderTop: `var(--hair-width) solid ${UI.hair}`, paddingTop: 16 }}>
            <div className="micro" style={{ color: UI.gold, marginBottom: 8 }}>SOCIAL TRANSPORT</div>
            <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.55 }}>
              Broadcast applies automatically to every current and future Friends user. Legacy is the global rollback if Broadcast has a problem.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 9 }}>
              <Btn kind="ghost" onClick={() => setSocialTransport('legacy')} disabled={socialTransportBusy || runtimeConfig?.socialTransport === 'legacy'}>Use Legacy</Btn>
              <Btn onClick={() => setSocialTransport('broadcast')} disabled={socialTransportBusy || runtimeConfig?.socialTransport === 'broadcast'}>Use Broadcast</Btn>
            </div>
          </div>
          <div style={{ borderTop: `var(--hair-width) solid ${UI.hair}`, paddingTop: 16 }}>
            <div className="micro" style={{ color: UI.gold, marginBottom: 8 }}>COACHING TRANSPORT</div>
            <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.55 }}>
              Broadcast covers coaching invitations, messages, support and coach-status badges. Legacy restores the four Postgres Changes tables before clients switch.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 9 }}>
              <Btn kind="ghost" onClick={() => setCoachingTransport('legacy')} disabled={coachingTransportBusy || runtimeConfig?.coachingTransport === 'legacy'}>Use Legacy</Btn>
              <Btn onClick={() => setCoachingTransport('broadcast')} disabled={coachingTransportBusy || runtimeConfig?.coachingTransport === 'broadcast'}>Use Broadcast</Btn>
            </div>
          </div>
          {dbStabilityMsg && <div style={{ fontSize: 12, color: dbStabilityMsg.ok ? 'var(--accent)' : UI.danger, fontFamily: UI.fontUi, padding: '8px 12px', background: dbStabilityMsg.ok ? 'rgba(var(--accent-rgb),0.16)' : 'rgba(var(--danger-rgb),0.08)', borderRadius: 6 }}>{dbStabilityMsg.text}</div>}
        </div>
      </SettingsSheet>

      <SettingsSheet open={broadcastSheet} onClose={() => setBroadcastSheet(false)} title="Message All Users">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
            Sends a message into every user's support ticket (creating one first if they don't have one yet), the same inbox they already use to reach support, so it shows up even on an older app version.
          </div>
          <textarea
            value={broadcastBody}
            onChange={e => setBroadcastBody(e.target.value)}
            placeholder="Message to send to every user…"
            rows={5}
            style={{
              width: '100%', boxSizing: 'border-box', resize: 'vertical',
              background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4,
              padding: '10px 12px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none',
            }}
          />
          {broadcastMsg && (
            <div style={{ fontSize: 12, color: broadcastMsg.ok ? 'var(--accent)' : UI.danger, fontFamily: UI.fontUi, padding: '8px 12px', background: broadcastMsg.ok ? 'rgba(var(--accent-rgb),0.16)' : 'rgba(var(--danger-rgb),0.08)', borderRadius: 6 }}>
              {broadcastMsg.text}
            </div>
          )}
          <Btn onClick={sendBroadcast} disabled={!broadcastBody.trim() || broadcastSending}>
            {broadcastSending ? 'Sending…' : 'Send to all users'}
          </Btn>
        </div>
      </SettingsSheet>

      {/* ══ Update tools (admin) ══ */}
      <SettingsSheet open={updateToolsSheet} onClose={() => setUpdateToolsSheet(false)} title="Update Tools">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
            Force refresh broadcasts the update banner to every connected user without needing an sw.js cache bump. Test update banner only shows it on this device, to preview the banner itself.
          </div>
          <Frame style={{ padding: '0 14px' }}>
            <NavRow label="Force refresh all users" onTap={handleForceUpdateAll} first />
            <NavRow label="Test update banner" onTap={onTestUpdateBanner} />
          </Frame>
        </div>
      </SettingsSheet>

      {/* ══ VIP backgrounds sheet (admin) ══ */}
      <SettingsSheet open={vipBgSheet} onClose={() => setVipBgSheet(false)} title="VIP Backgrounds">
        {(() => {
          const opts = vipBgOptions;
          const iStyle = { ...SETTINGS_INPUT_STYLE, padding: '10px 12px' };
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="micro" style={{ color: UI.inkFaint }}>EMAIL</div>
                <input
                  type="email"
                  value={vipBgEmail}
                  onChange={e => setVipBgEmail(e.target.value)}
                  placeholder="user@example.com"
                  style={iStyle}
                />
                <div className="micro" style={{ color: UI.inkFaint, marginTop: 4 }}>BACKGROUND</div>
                <select
                  value={vipBgKey}
                  onChange={e => setVipBgKey(e.target.value)}
                  style={{ ...iStyle, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer' }}
                  disabled={!opts}
                >
                  <option value="">{opts ? 'None (clear)' : 'Loading…'}</option>
                  {(opts || []).map(o => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
                {vipBgMsg && (
                  <div style={{ fontSize: 12, color: vipBgMsg.ok ? 'var(--accent)' : UI.danger, fontFamily: UI.fontUi, padding: '8px 12px', background: vipBgMsg.ok ? 'rgba(var(--accent-rgb),0.16)' : 'rgba(var(--danger-rgb),0.08)', borderRadius: 6 }}>
                    {vipBgMsg.text}
                  </div>
                )}
                <Btn onClick={saveVipBg} disabled={!vipBgEmail.trim() || vipBgSaving}>
                  {vipBgSaving ? 'Saving…' : vipBgKey ? 'Assign background' : 'Clear background'}
                </Btn>
              </div>
              <Frame style={{ padding: '0 14px' }}>
                <NavRow label="Current assignments" hint={vipBgList.length > 0 ? `${vipBgList.length}` : 'None'} first onTap={() => setVipBgListSheet(true)} />
              </Frame>
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ VIP backgrounds, current assignments sub-sheet ══ */}
      <SettingsSheet open={vipBgListSheet} onClose={() => setVipBgListSheet(false)} title="Current Assignments">
        {(() => {
          const opts = vipBgOptions || [];
          if (vipBgList.length === 0) {
            return <div className="micro" style={{ color: UI.inkGhost, padding: '4px 0 12px' }}>No backgrounds assigned yet.</div>;
          }
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
              {vipBgList.map((row, i) => {
                const opt = opts.find(o => o.key === row.bg_key);
                return (
                  <div key={row.email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.email}</div>
                      <div style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkFaint, marginTop: 1 }}>{opt?.label || row.bg_key}</div>
                    </div>
                    <button onClick={() => { setVipBgEmail(row.email); setVipBgKey(''); setVipBgMsg(null); setVipBgListSheet(false); }} style={{ background: 'none', border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4, padding: '4px 10px', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, cursor: 'pointer', flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
                      Clear
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Auto-approve batch sheet (admin), rendered after adminSheet so it sits on top ══ */}

      {/* ══ Support Center full-screen sheet (user) ══ */}
      <FullSheet
        open={supportSheet}
        onClose={
          supportView === 'thread'
            ? () => { setSupportView('list'); setSupportActiveTicketId(null); setSupportDraft(''); }
            : supportView === 'new'
            ? () => setSupportView('list')
            : () => setSupportSheet(false)
        }
        title="Support Center"
      >
        {(() => {
          const CATS = [
            { key: 'feature_request', label: 'Feature request', icon: 'fa-lightbulb' },
            { key: 'bug',             label: 'Bug',             icon: 'fa-bug' },
            { key: 'question',        label: 'General question', icon: 'fa-circle-question' },
          ];
          const statusColor = { open: 'var(--accent)', in_progress: UI.gold, resolved: UI.inkFaint };
          const statusLabel = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };
          const tickets = store.supportTickets || [];
          const iStyle = SETTINGS_TEXTAREA_STYLE;

          // ── NEW TICKET VIEW ──────────────────────────────────────────
          if (supportView === 'new') {
            return (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {/* scrollable top section */}
                <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px' }}>
                  <button onClick={() => setSupportView('list')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, textAlign: 'left', padding: 0, WebkitTapHighlightColor: 'transparent' }}>
                    ← Back
                  </button>
                  <div>
                    <div className="micro" style={{ marginBottom: 8 }}>TOPIC</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {CATS.map(c => (
                        <button key={c.key} onClick={() => setSupportCategoryDraft(c.key)} style={{
                          flex: 1, padding: '8px 4px', borderRadius: 6, cursor: 'pointer',
                          border: `var(--hair-width) solid ${supportCategoryDraft === c.key ? 'var(--hair-accent)' : UI.hairStrong}`,
                          background: supportCategoryDraft === c.key ? 'rgba(var(--accent-rgb),0.22)' : UI.bgInset,
                          color: supportCategoryDraft === c.key ? 'var(--accent)' : UI.inkFaint,
                          fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
                          WebkitTapHighlightColor: 'transparent', textAlign: 'center', textShadow: 'none',
                        }}>
                          <i className={`fa-solid ${c.icon}`} style={{ display: 'block', fontSize: 14, marginBottom: 4 }} />
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {/* sticky compose at bottom */}
                <div style={{ flexShrink: 0, borderTop: `var(--hair-width) solid ${UI.hair}`, padding: '14px 20px', paddingBottom: 'calc(env(safe-area-inset-bottom, 8px) + 14px)', display: 'flex', flexDirection: 'column', gap: 8, background: UI.bgRaised }}>
                  {supportImagePreview && (
                    <div style={{ position: 'relative', display: 'inline-block', alignSelf: 'flex-start' }}>
                      <img src={supportImagePreview} alt="" style={{ maxHeight: 100, maxWidth: 160, borderRadius: 6, display: 'block', objectFit: 'cover' }} />
                      <button onClick={() => { setSupportImageFile(null); setSupportImagePreview(null); }} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: UI.inkSoft, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, textShadow: 'none' }}>×</button>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <textarea value={supportDraft} onChange={e => setSupportDraft(e.target.value)}
                      onPaste={onPasteSupportMessage}
                      placeholder="Describe your request…" rows={4} style={{ ...iStyle, flex: 1 }} />
                    <label style={{ cursor: 'pointer', flexShrink: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: supportImageFile ? 'rgba(var(--accent-rgb),0.22)' : UI.bgInset, border: `var(--hair-width) solid ${supportImageFile ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`, color: supportImageFile ? 'var(--accent)' : UI.inkFaint }}>
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImagePick} />
                      <i className="fa-solid fa-image" style={{ fontSize: 15 }} />
                    </label>
                  </div>
                  <Btn onClick={handleCreateTicket} disabled={(!supportDraft.trim() && !supportImageFile) || supportSending}>
                    {supportSending ? 'Creating…' : 'Create ticket'}
                  </Btn>
                </div>
              </div>
            );
          }

          // ── THREAD VIEW ──────────────────────────────────────────────
          if (supportView === 'thread') {
            const activeTicket = tickets.find(t => t.coachingId === supportActiveTicketId);
            const statusDot = { open: UI.danger, in_progress: UI.gold, resolved: UI.inkFaint };
            return (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderBottom: `var(--hair-width) solid ${UI.hair}`, flexShrink: 0 }}>
                  <button onClick={() => { setSupportView('list'); setSupportActiveTicketId(null); setSupportDraft(''); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, padding: 0, flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
                    ← Back
                  </button>
                  {activeTicket && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusDot[activeTicket.status] || UI.inkFaint, display: 'inline-block', flexShrink: 0 }} />
                      <span className="micro" style={{ color: UI.inkSoft }}>{statusLabel[activeTicket.status] || activeTicket.status}</span>
                      <span className="micro" style={{ color: UI.inkFaint }}>· {CATS.find(c => c.key === activeTicket.category)?.label}</span>
                    </div>
                  )}
                </div>
                {/* Messages, scrollable */}
                <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 20px', minHeight: 0 }}>
                  {supportActiveLoading && <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '12px 0' }}>Loading…</div>}
                  {!supportActiveLoading && supportActiveNotes.length === 0 && (
                    <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '24px 0' }}>No messages yet.</div>
                  )}
                  {(() => {
                    const myNotes = supportActiveNotes.filter(n => n.author_id === userId);
                    const lastReadId = [...myNotes].reverse().find(n => n.read_at)?.id;
                    return supportActiveNotes.map(n => {
                      const isMe = n.author_id === userId;
                      const editing = supportEditingNoteId === n.id;
                      const modifiable = isMe && canModifySupportNote(n);
                      const hasImg = Array.isArray(n.attachments) && n.attachments.length > 0;
                      return (
                        <div key={n.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                          <div style={{ maxWidth: '80%', padding: hasImg ? '6px' : '9px 13px', borderRadius: isMe ? '8px 8px 4px 8px' : '8px 8px 8px 4px', background: isMe ? 'rgba(var(--accent-rgb),0.15)' : UI.bgRaised, border: `var(--hair-width) solid ${isMe ? 'rgba(var(--accent-rgb),0.25)' : UI.hair}`, overflow: 'hidden' }}>
                            {editing ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 190 }}>
                                <textarea value={supportEditingBody} onChange={e => setSupportEditingBody(e.target.value)} rows={3} autoFocus
                                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveSupportEdit(n); } }}
                                  style={{ width: '100%', minHeight: 68, resize: 'vertical', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 4, padding: '7px 8px', fontFamily: UI.fontUi, fontSize: 12, color: UI.ink, outline: 'none' }} />
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 5 }}>
                                  <button onClick={cancelSupportEdit} disabled={supportNoteActionBusy} style={{ background: 'none', border: 'none', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Cancel</button>
                                  <Btn onClick={() => saveSupportEdit(n)} disabled={supportNoteActionBusy || !supportEditingBody.trim()} style={{ minHeight: 26, padding: '4px 8px', fontSize: 10 }}>{supportNoteActionBusy ? '...' : 'Save'}</Btn>
                                </div>
                              </div>
                            ) : <>
                              {hasImg && n.attachments.map((a, i) => (
                                <img key={i} src={a.url} alt="" onClick={() => setLightboxSrc(a.url)} style={{ display: 'block', maxWidth: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 4, marginBottom: n.body ? 4 : 0, cursor: 'pointer' }} />
                              ))}
                              {n.body ? <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: hasImg ? '0 6px 4px' : 0 }}>{n.body}</div> : null}
                            </>}
                          </div>
                          <div className="micro" style={{ color: UI.inkGhost, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>{isMe ? 'You' : 'Support'} · {new Date(n.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} {new Date(n.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                            {isMe && n.id === lastReadId && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Seen</span>}
                            {n.edited_at && <span style={{ color: UI.inkFaint }}>edited</span>}
                          </div>
                          {modifiable && !editing && <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                            {n.body && <button onClick={() => beginSupportEdit(n)} disabled={supportNoteActionBusy} style={{ background: 'none', border: 'none', padding: 0, color: UI.gold, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Edit</button>}
                            <button onClick={() => removeSupportNote(n)} disabled={supportNoteActionBusy} style={{ background: 'none', border: 'none', padding: 0, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Delete</button>
                          </div>}
                        </div>
                      );
                    });
                  })()}
                  <div ref={supportBottomRef} />
                </div>
                {/* Compose, sticks to bottom */}
                {activeTicket?.status !== 'resolved' ? (
                  <div style={{ flexShrink: 0, borderTop: `var(--hair-width) solid ${UI.hair}`, padding: '14px 20px', paddingBottom: 'calc(env(safe-area-inset-bottom, 8px) + 14px)', display: 'flex', flexDirection: 'column', gap: 8, background: UI.bgRaised }}>
                    {supportImagePreview && (
                      <div style={{ position: 'relative', display: 'inline-block', alignSelf: 'flex-start' }}>
                        <img src={supportImagePreview} alt="" style={{ maxHeight: 100, maxWidth: 160, borderRadius: 6, display: 'block', objectFit: 'cover' }} />
                        <button onClick={() => { setSupportImageFile(null); setSupportImagePreview(null); }} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: UI.inkSoft, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, textShadow: 'none' }}>×</button>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                      <textarea value={supportDraft} onChange={e => setSupportDraft(e.target.value)}
                        placeholder="Write a message…" rows={3} style={{ ...iStyle, flex: 1 }}
                        onPaste={onPasteSupportMessage}
                        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSupportSend(); }} />
                      <label style={{ cursor: 'pointer', flexShrink: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: supportImageFile ? 'rgba(var(--accent-rgb),0.22)' : UI.bgInset, border: `var(--hair-width) solid ${supportImageFile ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`, color: supportImageFile ? 'var(--accent)' : UI.inkFaint }}>
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImagePick} />
                        <i className="fa-solid fa-image" style={{ fontSize: 15 }} />
                      </label>
                    </div>
                    <Btn onClick={handleSupportSend} disabled={(!supportDraft.trim() && !supportImageFile) || supportSending}>
                      {supportSending ? 'Sending…' : 'Send'}
                    </Btn>
                  </div>
                ) : (
                  <div style={{ flexShrink: 0, borderTop: `var(--hair-width) solid ${UI.hair}`, padding: '14px 20px', fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', lineHeight: 1.5 }}>
                    This ticket is resolved. Go back to open a new one.
                  </div>
                )}
              </div>
            );
          }

          // ── LIST VIEW (default) ──────────────────────────────────────
          const statusBorder = { open: UI.danger, in_progress: UI.gold, resolved: UI.inkFaint };
          const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const isUserArchived = t => t.archived && t.status === 'resolved' && t.archivedAt && new Date(t.archivedAt).getTime() <= sevenDaysAgo;
          const activeTickets   = tickets.filter(t => !isUserArchived(t));
          const archivedTickets = tickets.filter(t =>  isUserArchived(t));
          const renderTicket = t => (
            <button key={t.coachingId}
              onClick={() => { setSupportActiveTicketId(t.coachingId); setSupportView('thread'); }}
              style={{ width: '100%', background: UI.bgRaised, border: `var(--hair-width) solid ${UI.hair}`, borderLeft: `3px solid ${statusBorder[t.status] || UI.hairStrong}`, borderRadius: 8, padding: '11px 14px', textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent', display: 'flex', flexDirection: 'column', gap: 5, textShadow: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="micro" style={{ color: statusBorder[t.status] || UI.inkFaint }}>{statusLabel[t.status] || t.status}</span>
                  <span className="micro" style={{ color: UI.inkFaint }}>· {CATS.find(c => c.key === t.category)?.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t.unreadCount > 0 && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, animation: 'pulseDot 1.5s ease-in-out infinite' }} />}
                  <span className="micro" style={{ color: UI.inkGhost }}>{fmtAgo(t.lastMessageAt || t.createdAt)}</span>
                </div>
              </div>
              {t.lastMessageBody ? (
                <div style={{ fontSize: 12, color: UI.inkSoft, fontFamily: UI.fontUi, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.lastMessageBody}</div>
              ) : (
                <div style={{ fontSize: 12, color: UI.inkGhost, fontFamily: UI.fontUi, fontStyle: 'italic' }}>No messages yet</div>
              )}
            </button>
          );
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 20px', flex: 1 }}>
              {activeTickets.length === 0 && archivedTickets.length === 0 && (
                <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '24px 0' }}>
                  No tickets yet. Tap "+ New ticket" if you need help.
                </div>
              )}
              {activeTickets.map(renderTicket)}
              {archivedTickets.length > 0 && (
                <UserArchivedSection tickets={archivedTickets} renderTicket={renderTicket} />
              )}
              <div style={{ flexGrow: 1 }} />
              <Btn onClick={() => { setSupportView('new'); setSupportDraft(''); setSupportCategoryDraft('question'); }} style={{ width: '100%', marginBottom: 'env(safe-area-inset-bottom, 0px)' }}>+ New ticket</Btn>
            </div>
          );
        })()}
      </FullSheet>

      {/* ══ Support inbox full-screen sheet (admin), inbox list + ticket detail in one ══ */}
      <FullSheet
        open={supportInboxSheet}
        onClose={supportTicket
          ? () => { setSupportTicket(null); setSupportAdminDraft(''); }
          : () => { setSupportInboxSheet(false); setSupportCatFilter('all'); setShowArchived(false); }
        }
        title={supportTicket ? (supportTicket.clientName || supportTicket.clientEmail) : 'Support inbox'}
      >
        {(() => {
          const CATS = { feature_request: 'Feature', bug: 'Bug', question: 'Question' };
          const iStyle = SETTINGS_TEXTAREA_STYLE;

          // ── TICKET DETAIL VIEW ─────────────────────────────────────────
          if (supportTicket) {
            const STATUSES = [
              { key: 'open',        label: 'Open' },
              { key: 'in_progress', label: 'In progress' },
              { key: 'resolved',    label: 'Resolved' },
            ];
            const sColor = { open: UI.danger, in_progress: UI.inkFaint, resolved: 'var(--accent)' };
            const sBg    = { open: 'rgba(var(--danger-rgb),0.18)', in_progress: UI.bgInset, resolved: 'rgba(var(--accent-rgb),0.22)' };
            const currentStatus = supportInbox.find(t => t.coaching_id === supportTicket.coachingId)?.support_status || supportTicket.status || 'open';
            return (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                {/* Back + meta */}
                <div style={{ padding: '12px 20px', borderBottom: `var(--hair-width) solid ${UI.hair}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => { setSupportTicket(null); setSupportAdminDraft(''); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 13, padding: 0, flexShrink: 0, WebkitTapHighlightColor: 'transparent' }}>
                    ← Back
                  </button>
                  <span className="micro" style={{ color: UI.inkFaint }}>{supportTicket.clientEmail}</span>
                  {supportTicket.xHandle && <a href={LB.xHandleUrl(supportTicket.xHandle)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="micro" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{supportTicket.xHandle}</a>}
                  {supportTicket.category && <span className="micro" style={{ color: UI.inkFaint }}>· {CATS[supportTicket.category] || supportTicket.category}</span>}
                </div>
                {/* Status picker */}
                <div style={{ display: 'flex', gap: 6, padding: '12px 20px', flexShrink: 0, borderBottom: `var(--hair-width) solid ${UI.hair}` }}>
                  {STATUSES.map(s => (
                    <button key={s.key} onClick={() => handleSetSupportStatus(supportTicket.coachingId, s.key)} style={{
                      flex: 1, padding: '7px 4px', borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                      border: `var(--hair-width) solid ${currentStatus === s.key ? sColor[s.key] : UI.hairStrong}`,
                      background: currentStatus === s.key ? sBg[s.key] : 'transparent',
                      color: currentStatus === s.key ? sColor[s.key] : UI.inkFaint,
                      fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                      textShadow: 'none',
                    }}>{s.label}</button>
                  ))}
                </div>
                {/* Thread, scrollable, takes remaining height */}
                <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 20px', minHeight: 0 }}>
                  {supportTicketLoading && <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '12px 0' }}>Loading…</div>}
                  {!supportTicketLoading && supportTicketNotes.length === 0 && (
                    <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '24px 0' }}>No messages yet.</div>
                  )}
                  {(() => {
                    const myNotes = supportTicketNotes.filter(n => n.author_id === userId);
                    const lastReadId = [...myNotes].reverse().find(n => n.read_at)?.id;
                    return supportTicketNotes.map(n => {
                      const isAdminMsg = n.author_id === userId;
                      const editing = supportEditingNoteId === n.id;
                      const modifiable = isAdminMsg && canModifySupportNote(n);
                      const hasImg = Array.isArray(n.attachments) && n.attachments.length > 0;
                      return (
                        <div key={n.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isAdminMsg ? 'flex-end' : 'flex-start' }}>
                          <div style={{
                            maxWidth: '80%', padding: hasImg ? '6px' : '9px 13px', borderRadius: isAdminMsg ? '8px 8px 4px 8px' : '8px 8px 8px 4px',
                            background: isAdminMsg ? 'rgba(var(--accent-rgb),0.15)' : UI.bgRaised,
                            border: `var(--hair-width) solid ${isAdminMsg ? 'rgba(var(--accent-rgb),0.25)' : UI.hair}`,
                            overflow: 'hidden',
                          }}>
                            {editing ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 190 }}>
                                <textarea value={supportEditingBody} onChange={e => setSupportEditingBody(e.target.value)} rows={3} autoFocus
                                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveSupportEdit(n); } }}
                                  style={{ width: '100%', minHeight: 68, resize: 'vertical', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hair}`, borderRadius: 4, padding: '7px 8px', fontFamily: UI.fontUi, fontSize: 12, color: UI.ink, outline: 'none' }} />
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 5 }}>
                                  <button onClick={cancelSupportEdit} disabled={supportNoteActionBusy} style={{ background: 'none', border: 'none', color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Cancel</button>
                                  <Btn onClick={() => saveSupportEdit(n)} disabled={supportNoteActionBusy || !supportEditingBody.trim()} style={{ minHeight: 26, padding: '4px 8px', fontSize: 10 }}>{supportNoteActionBusy ? '...' : 'Save'}</Btn>
                                </div>
                              </div>
                            ) : <>
                              {hasImg && n.attachments.map((a, i) => (
                                <img key={i} src={a.url} alt="" onClick={() => setLightboxSrc(a.url)} style={{ display: 'block', maxWidth: '100%', maxHeight: 300, objectFit: 'contain', borderRadius: 4, marginBottom: n.body ? 4 : 0, cursor: 'pointer' }} />
                              ))}
                              {n.body ? <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', padding: hasImg ? '0 6px 4px' : 0 }}>{n.body}</div> : null}
                            </>}
                          </div>
                          <div className="micro" style={{ color: UI.inkGhost, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>{isAdminMsg ? 'You' : supportTicket.clientName} · {new Date(n.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} {new Date(n.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>
                            {isAdminMsg && n.id === lastReadId && <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Seen</span>}
                            {n.edited_at && <span style={{ color: UI.inkFaint }}>edited</span>}
                          </div>
                          {modifiable && !editing && <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                            {n.body && <button onClick={() => beginSupportEdit(n)} disabled={supportNoteActionBusy} style={{ background: 'none', border: 'none', padding: 0, color: UI.gold, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Edit</button>}
                            <button onClick={() => removeSupportNote(n)} disabled={supportNoteActionBusy} style={{ background: 'none', border: 'none', padding: 0, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, cursor: 'pointer' }}>Delete</button>
                          </div>}
                        </div>
                      );
                    });
                  })()}
                  <div ref={adminBottomRef} />
                </div>
                {/* Compose, sticks to bottom */}
                <div style={{ flexShrink: 0, borderTop: `var(--hair-width) solid ${UI.hair}`, padding: '14px 20px', paddingBottom: 'calc(env(safe-area-inset-bottom, 8px) + 14px)', display: 'flex', flexDirection: 'column', gap: 8, background: UI.bgRaised }}>
                  {adminImagePreview && (
                    <div style={{ position: 'relative', display: 'inline-block', alignSelf: 'flex-start' }}>
                      <img src={adminImagePreview} alt="" style={{ maxHeight: 100, maxWidth: 160, borderRadius: 6, display: 'block', objectFit: 'cover' }} />
                      <button onClick={() => { setAdminImageFile(null); setAdminImagePreview(null); }} style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', background: UI.inkSoft, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, textShadow: 'none' }}>×</button>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <textarea value={supportAdminDraft} onChange={e => setSupportAdminDraft(e.target.value)}
                      placeholder="Reply…" rows={3} style={{ ...iStyle, flex: 1 }}
                      onPaste={onPasteAdminMessage}
                      onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdminReply(); }}
                    />
                    <label style={{ cursor: 'pointer', flexShrink: 0, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: adminImageFile ? 'rgba(var(--accent-rgb),0.22)' : UI.bgInset, border: `var(--hair-width) solid ${adminImageFile ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`, color: adminImageFile ? 'var(--accent)' : UI.inkFaint }}>
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAdminImagePick} />
                      <i className="fa-solid fa-image" style={{ fontSize: 15 }} />
                    </label>
                  </div>
                  <Btn onClick={handleAdminReply} disabled={(!supportAdminDraft.trim() && !adminImageFile) || supportAdminSending}>
                    {supportAdminSending ? 'Sending…' : 'Send reply'}
                  </Btn>
                  {currentStatus === 'resolved' && (
                    <Btn kind="ghost" onClick={handleArchiveTicket} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, color: UI.inkFaint, borderColor: UI.hairStrong }}>
                      <i className="fa-solid fa-box-archive" style={{ fontSize: 12 }} /> Archive ticket
                    </Btn>
                  )}
                  {confirmDeleteTicket ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn kind="ghost" onClick={() => setConfirmDeleteTicket(false)} style={{ flex: 1, color: UI.inkFaint, borderColor: UI.hairStrong }}>Cancel</Btn>
                      <Btn onClick={handleDeleteTicket} disabled={deletingTicket} style={{ flex: 1, background: 'rgba(var(--danger-rgb),0.15)', color: 'rgba(var(--danger-rgb),1)', border: 'var(--hair-width) solid rgba(var(--danger-rgb),0.3)' }}>
                        {deletingTicket ? 'Deleting…' : 'Confirm delete'}
                      </Btn>
                    </div>
                  ) : (
                    <Btn kind="ghost" onClick={() => setConfirmDeleteTicket(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, color: 'rgba(var(--danger-rgb),0.7)', background: 'rgba(var(--danger-rgb),0.08)', borderColor: 'rgba(var(--danger-rgb),calc(0.25 * var(--danger-border-boost)))' }}>
                      <i className="fa-solid fa-trash" style={{ fontSize: 12 }} /> Delete ticket
                    </Btn>
                  )}
                </div>
              </div>
            );
          }

          // ── INBOX LIST VIEW ────────────────────────────────────────────
          const filterDefs = [
            { key: 'all', label: 'All' },
            { key: 'feature_request', label: 'Feature' },
            { key: 'bug', label: 'Bug' },
            { key: 'question', label: 'Question' },
          ];
          const filtered = supportCatFilter === 'all' ? supportInbox : supportInbox.filter(t => t.support_category === supportCatFilter);
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: '16px 20px' }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                {filterDefs.map(f => (
                  <button key={f.key} onClick={() => setSupportCatFilter(f.key)} style={{
                    padding: '5px 14px', borderRadius: 999, cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                    border: `var(--hair-width) solid ${supportCatFilter === f.key ? 'var(--hair-accent)' : UI.hairStrong}`,
                    background: supportCatFilter === f.key ? 'rgba(var(--accent-rgb),0.18)' : 'transparent',
                    color: supportCatFilter === f.key ? 'var(--accent)' : UI.inkFaint,
                    fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600,
                  }}>{f.label}</button>
                ))}
              </div>
              {supportInboxLoading && <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '16px 0' }}>Loading…</div>}
              {!supportInboxLoading && filtered.length === 0 && (
                <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, textAlign: 'center', padding: '24px 0' }}>
                  {supportInbox.length === 0 ? 'No support tickets yet.' : 'No tickets in this category.'}
                </div>
              )}
              {filtered.map(t => (
                <AdminTicketRow key={t.coaching_id} t={t} catLabel={CATS[t.support_category] || t.support_category}
                  onClick={() => setSupportTicket({ coachingId: t.coaching_id, clientName: t.client_name, clientEmail: t.client_email, xHandle: t.x_handle, category: t.support_category, status: t.support_status })} />
              ))}
              {/* ── Archived section ── */}
              <div style={{ borderTop: `var(--hair-width) solid ${UI.hair}`, marginTop: 4, paddingTop: 12 }}>
                <button onClick={async () => {
                  if (showArchived) { setShowArchived(false); return; }
                  setShowArchived(true);
                  setArchivedLoading(true);
                  const { data } = await LB.supabase.rpc('get_archived_support_chats');
                  setArchivedInbox(data || []);
                  setArchivedLoading(false);
                }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 12, letterSpacing: '0.04em', WebkitTapHighlightColor: 'transparent', display: 'flex', alignItems: 'center', gap: 6, marginBottom: showArchived ? 12 : 0 }}>
                  <i className={`fa-solid fa-chevron-${showArchived ? 'up' : 'down'}`} style={{ fontSize: 9 }} />
                  Archived
                </button>
                {showArchived && (
                  archivedLoading
                    ? <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, padding: '8px 0' }}>Loading…</div>
                    : archivedInbox.length === 0
                    ? <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, fontStyle: 'italic', padding: '8px 0' }}>No archived tickets.</div>
                    : archivedInbox.map(t => (
                      <AdminTicketRow key={t.coaching_id} t={t} archived catLabel={CATS[t.support_category] || t.support_category}
                        onClick={() => setSupportTicket({ coachingId: t.coaching_id, clientName: t.client_name, clientEmail: t.client_email, xHandle: t.x_handle, category: t.support_category, status: t.support_status })} />
                    ))
                )}
              </div>
            </div>
          );
        })()}
      </FullSheet>


      {/* ══ All users sheet (admin) ══, folds in what used to be separate
          Recent sign-ups (New sign-ups only filter) and Onboarded (Onboarded
          only filter) sheets, plus the SW-version lookup. */}
      <SettingsSheet open={allUsersSheet} onClose={() => setAllUsersSheet(false)} title="All users">
        {(() => {
          const q = allUsersSearch.trim().toLowerCase();
          const recentCutoff = Date.now() - 7 * 86400000;
          const filtered = allUsers.filter(u => {
            if (allUsersNewOnly && !isNewSignup(u)) return false;
            if (allUsersOnboardedOnly && !(u.plan_count > 0)) return false;
            if (allUsersOutdatedOnly && swVersion && u.sw_version === swVersion) return false;
            if (allUsersRecentOnly && !(u.last_workout && new Date(u.last_workout).getTime() >= recentCutoff)) return false;
            if (!q) return true;
            return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.x_handle || '').toLowerCase().includes(q);
          });
          const openUserDetail = (u) => {
            setAdminUserDetail({ userId: u.user_id, name: u.name, email: u.email, xHandle: u.x_handle, xHandlePublic: u.x_handle_public, plans: null, exercises: null });
            setAdminUserDetailLoading(true);
            setAdminUserDetailSheet(true);
            setAdminEmailSubject('');
            setAdminEmailBody('');
            setAdminEmailMsg(null);
            LB.supabase.rpc('get_user_detail_admin', { p_user_id: u.user_id })
              .then(({ data, error }) => {
                if (error || !data) { setAdminUserDetailLoading(false); return; }
                setAdminUserDetail({ userId: u.user_id, name: u.name, email: u.email, xHandle: data.x_handle ?? u.x_handle, xHandlePublic: data.x_handle_public ?? u.x_handle_public, activeScheduleId: data.active_schedule_id || null, plans: data.plans || [] });
                setAdminUserDetailLoading(false);
              }).catch(() => setAdminUserDetailLoading(false));
          };
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <input
                value={allUsersSearch}
                onChange={e => setAllUsersSearch(e.target.value)}
                placeholder="Search by name, email or X handle…"
                style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4, padding: '10px 12px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none', width: '100%', boxSizing: 'border-box' }}
              />
              <Frame style={{ padding: '0 14px' }}>
                <Row label="New sign-ups only" first>
                  <Toggle on={allUsersNewOnly} onToggle={() => setAllUsersNewOnly(v => !v)} />
                </Row>
                <Row label="Onboarded only">
                  <Toggle on={allUsersOnboardedOnly} onToggle={() => setAllUsersOnboardedOnly(v => !v)} />
                </Row>
                <Row label="Trained in last 7 days">
                  <Toggle on={allUsersRecentOnly} onToggle={() => setAllUsersRecentOnly(v => !v)} />
                </Row>
                <Row label="Outdated version only">
                  <Toggle on={allUsersOutdatedOnly} onToggle={() => setAllUsersOutdatedOnly(v => !v)} />
                </Row>
              </Frame>
              {allUsersOutdatedOnly && !swVersion && (
                <div className="micro" style={{ color: UI.inkFaint }}>Your own version isn't known yet, this device hasn't reported one.</div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div className="micro" style={{ color: UI.inkGhost }}>{filtered.length} of {allUsers.length}{swVersion ? ` · you're on ${swVersion}` : ''}</div>
                {filtered.some(u => !seenSignups.has(u.user_id)) && (
                  <button
                    onClick={() => markAllSignupsSeen(filtered.filter(u => !seenSignups.has(u.user_id)).map(u => u.user_id))}
                    style={{ ...accentBtn, padding: '3px 8px', fontSize: 9 }}
                  >
                    Mark all seen
                  </button>
                )}
              </div>
              {filtered.length === 0 ? (
                <div className="micro" style={{ color: UI.inkGhost, padding: '4px 0 12px' }}>No matching users.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
                  {filtered.map((u, i) => {
                    const isCurrent = swVersion && u.sw_version === swVersion;
                    const isNew = !seenSignups.has(u.user_id);
                    return (
                      <div key={u.user_id} onClick={() => openUserDetail(u)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                        <div style={{ width: 34, height: 34, borderRadius: '50%', background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ fontFamily: UI.fontUi, fontSize: 14, fontWeight: 700, color: UI.inkSoft }}>{(u.name || u.email || '?')[0].toUpperCase()}</span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 14, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || '—'}</span>
                            {u.tier && u.tier !== 'free' && (
                              <span className="micro" style={{ flexShrink: 0, color: 'var(--accent)' }}>{u.tier === 'lifetime' ? 'LIFETIME' : 'PREMIUM'}</span>
                            )}
                            {isNew && <span className="micro" style={{ flexShrink: 0, color: UI.gold }}>NEW</span>}
                          </div>
                          {u.x_handle && <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <a href={LB.xHandleUrl(u.x_handle)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="micro" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{u.x_handle}</a>
                            {u.x_handle_public === false && <span className="micro" style={{ color: UI.inkGhost }}>PRIVATE</span>}
                          </div>}
                          <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontUi, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {u.plan_count} {u.plan_count === 1 ? 'plan' : 'plans'} · joined {fmtAgo(u.created_at)} · last workout {u.last_workout ? fmtAgo(u.last_workout) : 'never'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
                          <span className="num" style={{ fontSize: 11, color: !u.sw_version ? UI.inkGhost : isCurrent ? UI.inkFaint : UI.gold }}>
                            {u.sw_version || '—'}
                          </span>
                          {isNew && (
                            <button onClick={e => { e.stopPropagation(); markSignupSeen(u.user_id); }} style={{ ...accentBtn, padding: '3px 8px', fontSize: 9 }}>Got it</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ User detail sheet (admin, plans list) ══ */}
      <SettingsSheet open={adminUserDetailSheet} onClose={() => setAdminUserDetailSheet(false)} title={adminUserDetail?.name || adminUserDetail?.email || 'User'}>
        {adminUserDetailLoading
          ? <div style={{ fontSize: 13, color: UI.inkFaint, fontFamily: UI.fontUi, padding: '8px 0' }}>Loading…</div>
          : adminUserDetail && (
            <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
              {adminUserDetail.xHandle && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 0 16px' }}>
                  <span className="micro" style={{ color: UI.inkGhost }}>X HANDLE</span>
                  <a href={LB.xHandleUrl(adminUserDetail.xHandle)} target="_blank" rel="noreferrer" className="micro" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{adminUserDetail.xHandle}</a>
                  {adminUserDetail.xHandlePublic === false && <span className="micro" style={{ color: UI.inkGhost }}>PRIVATE</span>}
                </div>
              )}
              <div className="micro" style={{ color: UI.inkGhost, paddingBottom: 8 }}>SEND EMAIL</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi }}>To {adminUserDetail.email}</div>
                <input
                  value={adminEmailSubject}
                  onChange={e => setAdminEmailSubject(e.target.value)}
                  placeholder="Subject"
                  style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4, padding: '10px 12px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none', width: '100%', boxSizing: 'border-box' }}
                />
                <textarea
                  value={adminEmailBody}
                  onChange={e => setAdminEmailBody(e.target.value)}
                  placeholder="Message…"
                  rows={5}
                  style={{
                    width: '100%', boxSizing: 'border-box', resize: 'vertical',
                    background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4,
                    padding: '10px 12px', fontFamily: UI.fontUi, fontSize: 14, color: UI.ink, outline: 'none',
                  }}
                />
                {adminEmailMsg && (
                  <div style={{ fontSize: 12, color: adminEmailMsg.ok ? 'var(--accent)' : UI.danger, fontFamily: UI.fontUi, padding: '8px 12px', background: adminEmailMsg.ok ? 'rgba(var(--accent-rgb),0.16)' : 'rgba(var(--danger-rgb),0.08)', borderRadius: 6 }}>
                    {adminEmailMsg.text}
                  </div>
                )}
                <Btn onClick={sendAdminEmail} disabled={!adminEmailSubject.trim() || !adminEmailBody.trim() || adminEmailSending}>
                  {adminEmailSending ? 'Sending…' : 'Send email'}
                </Btn>
              </div>
              <Hairline style={{ marginBottom: 16 }} />
              <div className="micro" style={{ color: UI.inkGhost, paddingBottom: 8 }}>PLANS</div>
              {(adminUserDetail.plans || []).length === 0
                ? <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, fontStyle: 'italic' }}>No plans.</div>
                : (adminUserDetail.plans || []).map((p, i, arr) => {
                    const isActive = p.id === adminUserDetail.activeScheduleId;
                    return (
                      <button key={p.id} onClick={() => { setAdminPlanDetail(p); setAdminPlanDetailSheet(true); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', marginBottom: i < arr.length - 1 ? 8 : 0, background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, width: '100%', textAlign: 'left', cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 13, color: p.archived ? UI.inkFaint : UI.ink, fontFamily: UI.fontUi, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                            {isActive && <span className="micro" style={{ color: 'var(--accent)', flexShrink: 0 }}>ACTIVE</span>}
                          </div>
                          <div style={{ fontSize: 11, color: UI.inkGhost, fontFamily: UI.fontUi, marginTop: 2 }}>
                            {p.is_flex ? 'flex' : (p.days || []).some(d => d.weekday != null) ? 'weekday' : 'cycle'}
                            {' · '}{p.day_count} {p.day_count === 1 ? 'day' : 'days'}
                            {p.sessions_per_week ? ` · ${p.sessions_per_week}×/week` : ''}
                          </div>
                        </div>
                        {p.archived
                          ? <span className="micro" style={{ color: UI.inkGhost, flexShrink: 0 }}>ARCHIVED</span>
                          : <i className="fa-solid fa-chevron-right" style={{ fontSize: 10, color: UI.inkGhost }} />
                        }
                      </button>
                    );
                  })
              }
            </div>
          )
        }
      </SettingsSheet>

      {/* ══ Plan detail sheet (admin, day chips + exercise cards) ══ */}
      <SettingsSheet open={adminPlanDetailSheet} onClose={() => setAdminPlanDetailSheet(false)} title={adminPlanDetail?.name || 'Plan'}>
        {adminPlanDetail && (() => {
          const days = adminPlanDetail.days || [];
          const day = days.find(d => d.id === adminPlanSelectedDayId) || days[0];
          const dayIdx = days.findIndex(d => d.id === (day?.id));
          const isRest = !day || !(day.items || []).length || day.name === 'REST';
          const planType = adminPlanDetail.is_flex ? 'flex' : days.some(d => d.weekday != null) ? 'weekday' : 'cycle';
          const trainingDays = days.filter(d => (d.items || []).length && d.name !== 'REST').length;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, margin: '0 -16px' }}>
              {/* plan type */}
              <div className="micro" style={{ color: UI.inkGhost, padding: '0 16px 10px' }}>
                {planType.toUpperCase()} · {trainingDays} {trainingDays === 1 ? 'workout' : 'workouts'}
                {adminPlanDetail.sessions_per_week ? ` · ${adminPlanDetail.sessions_per_week}×/week` : ''}
              </div>
              {/* chip row */}
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', padding: '0 16px 14px' }}>
                {days.map((d, i) => {
                  const active = d.id === (day?.id);
                  const rest = !d.items?.length || d.name === 'REST';
                  return (
                    <button key={d.id || i} onClick={() => setAdminPlanSelectedDayId(d.id)} style={{
                      flexShrink: 0, maxWidth: 120, padding: '6px 12px 4px', borderRadius: 4,
                      border: `1px solid ${active ? UI.gold : UI.hairStrong}`,
                      background: active ? UI.goldFaint : 'transparent',
                      cursor: 'pointer', WebkitTapHighlightColor: 'transparent', transition: 'all 0.15s',
                    }}>
                      <div style={{ fontSize: 10, fontFamily: UI.fontUi, letterSpacing: '0.07em', fontWeight: 600, color: active ? UI.gold : rest ? UI.inkFaint : UI.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                      <div style={{ fontSize: 8, fontFamily: UI.fontUi, letterSpacing: '0.1em', color: active ? UI.gold : UI.inkFaint, marginTop: 1 }}>Day {i + 1}</div>
                    </button>
                  );
                })}
              </div>
              {/* day content */}
              {day && (
                <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
                  <div>
                    <div className="micro" style={{ color: UI.inkFaint, marginBottom: 4 }}>DAY {dayIdx + 1}</div>
                    <div className="display" style={{ fontSize: 30, color: isRest ? UI.inkSoft : UI.ink, fontStyle: isRest ? 'italic' : 'normal', lineHeight: 1.05, letterSpacing: '-0.01em' }}>{day.name}</div>
                  </div>
                  {isRest ? (
                    <div style={{ background: UI.bgRaised, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, padding: 36, textAlign: 'center' }}>
                      <div className="display-it" style={{ fontSize: 32, color: UI.inkSoft, fontWeight: 300, marginBottom: 6 }}>Recover.</div>
                      <div style={{ fontSize: 13, color: UI.inkFaint }}>Recovery is part of the plan.</div>
                    </div>
                  ) : (day.items || []).map((it, k) => {
                    const isUni = it.unilateral || it.movement_type === 'unilateral';
                    const isMob = it.movement_type === 'mobility';
                    return (
                      <div key={it.exId || k} style={{ background: UI.bgRaised, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 6, padding: '12px 16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi }}>
                              {it.name || '—'}
                              {isUni && <span className="micro" style={{ marginLeft: 6, color: UI.inkFaint }}>UNI</span>}
                              {isMob && <span className="micro" style={{ marginLeft: 6, color: UI.inkFaint }}>MOB</span>}
                            </span>
                          </div>
                          <span className="num" style={{ fontSize: 13, color: UI.inkSoft, flexShrink: 0 }}>
                            {it.sets} × {it.repsMax != null ? `${it.reps}-${it.repsMax}` : (it.reps || '—')}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Push notifications sheet ══ */}
      <SettingsSheet open={pushSheet} onClose={() => setPushSheet(false)} title="Push notifications">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          {isIosDevice && !pushEnabled && !iosDisclaimerSeen && (
            <div style={{ background: 'rgba(var(--accent-rgb),0.14)', border: 'var(--hair-width) solid rgba(var(--accent-rgb),0.2)', borderRadius: 6, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.55 }}>
                Push notifications on iPhone and iPad require Zane to be installed as an app on your home screen. For instructions, see <span style={{ color: 'var(--accent)' }}>Guides → How to… → Install as app</span>.
              </div>
              <button onClick={() => { setIosDisclaimerSeen(true); try { localStorage.setItem('logbook-push-ios-hint-seen', 'true'); } catch (_) {} }} style={{ ...accentBtn, alignSelf: 'flex-start' }}>Got it</button>
            </div>
          )}
          <Row label="This device" first>
            {webPushLoading
              ? <span style={{ fontFamily: UI.fontUi, fontSize: 13, color: UI.inkFaint }}>…</span>
              : <Toggle on={pushEnabled || webPushPending} onToggle={togglePush} />}
          </Row>
          {pushEnabled && store.settings?.usePushover && store.settings?.pushoverUserKey && (
            <div className="micro" style={{ color: UI.inkGhost, paddingLeft: 2 }}>Active via Pushover, see Advanced</div>
          )}
          {(pushEnabled || webPushPending) && !store.settings?.usePushover && webPushSub && (() => {
            const iStyle = { ...SETTINGS_INPUT_STYLE, fontSize: 20, letterSpacing: '0.3em', textAlign: 'center' };
            if (webPushStep === 'code-sent') {
              const pct = pendingCountdown / 120;
              const urgent = pendingCountdown <= 30;
              const barColor = urgent ? UI.warn : 'var(--accent)';
              const mins = Math.floor(pendingCountdown / 60);
              const secs = pendingCountdown % 60;
              const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="micro" style={{ color: UI.inkSoft }}>Enter the 6-digit code from the notification</div>
                    <div className="num" style={{ fontSize: 11, color: urgent ? UI.warn : UI.inkFaint, minWidth: 28, textAlign: 'right' }}>{timeStr}</div>
                  </div>
                  <div style={{ height: 2, background: UI.hairStrong, borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct * 100}%`, background: barColor, borderRadius: 999, transition: 'width 1s linear, background 0.5s' }} />
                  </div>
                  <input type="text" inputMode="numeric" maxLength={6} value={codeInput}
                    onChange={e => setCodeInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000" style={iStyle} autoFocus />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn kind="ghost" onClick={sendWebPushCode}>Resend</Btn>
                    <Btn onClick={verifyWebPushCode} disabled={codeInput.length !== 6} style={{ flex: 1 }}>Verify</Btn>
                  </div>
                </div>
              );
            }
            if (webPushVerified) return (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: 'rgba(var(--accent-rgb), 0.16)', border: 'var(--hair-width) solid rgba(var(--accent-rgb), 0.25)', borderRadius: 6, padding: '8px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 5px rgba(var(--accent-rgb),0.7)', animation: 'pulseDot 1.5s ease-in-out infinite', flexShrink: 0 }} />
                  <span className="micro" style={{ color: 'var(--accent)' }}>ACTIVE</span>
                </div>
                <div style={{ width: 0.5, height: 10, background: 'rgba(var(--accent-rgb), 0.35)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="fa-solid fa-circle-check" style={{ fontSize: 10, color: 'var(--accent)' }} />
                  <span className="micro" style={{ color: 'var(--accent)' }}>VERIFIED</span>
                </div>
              </div>
            );
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="micro" style={{ color: UI.inkGhost, paddingLeft: 2 }}>Active, not yet verified</div>
                <button onClick={sendWebPushCode} style={accentBtn}>Send verification code</button>
              </div>
            );
          })()}
          {pushStatus && <div className="micro" style={{ color: pushStatus.startsWith('✓') ? 'var(--accent)' : UI.inkSoft, textAlign: 'center', padding: '6px 0' }}>{pushStatus}</div>}
          {pushEnabled && (
            <Row label="Advanced">
              <button onClick={() => setAdvancedPushSheet(true)} style={accentBtn}>Open</button>
            </Row>
          )}
          <Btn onClick={() => setPushSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Advanced push sheet ══ */}
      <SettingsSheet open={advancedPushSheet} onClose={closeAdvanced} title="Advanced">
        {(() => {
          const isVerified = !!(store.settings?.usePushover && store.settings?.pushoverUserKey);
          const inputStyle = { ...SETTINGS_INPUT_STYLE, fontSize: 13 };
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
              <Row label="Use Pushover" first>
                <Toggle
                  on={isVerified || pushoverStep !== 'idle'}
                  onToggle={() => {
                    if (isVerified) { disablePushover(); }
                    else if (pushoverStep !== 'idle') { setPushoverStep('idle'); setPushKeyDraft(''); setCodeInput(''); setPendingCode(''); }
                    else { setPushoverStep('entering-key'); }
                  }}
                />
              </Row>
              <div className="micro" style={{ color: UI.inkFaint, lineHeight: 1.5 }}>
                Uses the Pushover app instead of browser push for rest timer notifications. Delivers even without the PWA installed.
              </div>

              {!isVerified && pushoverStep === 'entering-key' && (
                <>
                  <input value={pushKeyDraft} onChange={e => setPushKeyDraft(e.target.value)}
                    placeholder="Pushover user key (from pushover.net)"
                    style={inputStyle} autoCorrect="off" autoCapitalize="none" spellCheck={false} />
                  <Btn onClick={sendVerificationCode} disabled={pushKeyDraft.trim().length < 10 || verifyLoading}>
                    {verifyLoading ? 'Sending…' : 'Send verification code'}
                  </Btn>
                </>
              )}

              {!isVerified && pushoverStep === 'code-sent' && (
                <>
                  <div className="micro" style={{ color: UI.inkFaint }}>Enter the 6-digit code from your Pushover notification</div>
                  <input value={codeInput} onChange={e => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000" inputMode="numeric" maxLength={6} autoFocus
                    style={{ ...inputStyle, fontSize: 20, letterSpacing: '0.3em', textAlign: 'center' }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn kind="ghost" onClick={() => { setCodeInput(''); setPendingCode(''); sendVerificationCode(); }}>Resend</Btn>
                    <Btn onClick={verifyCode} disabled={codeInput.length !== 6} style={{ flex: 1 }}>Verify</Btn>
                  </div>
                </>
              )}

              {isVerified && (
                <>
                  <div className="micro" style={{ color: UI.inkFaint }}>Active · key …{store.settings.pushoverUserKey.slice(-8)}</div>
                  <Row label="Test rest timer">
                    <button onClick={() => setTestPickerOpen(true)} style={accentBtn}>Send</button>
                  </Row>
                </>
              )}

              {pushStatus && <div className="micro" style={{ color: pushStatus.startsWith('✓') ? 'var(--accent)' : UI.inkSoft, textAlign: 'center', padding: '6px 0' }}>{pushStatus}</div>}
              <Btn onClick={closeAdvanced}>Done</Btn>
            </div>
          );
        })()}
      </SettingsSheet>

      {/* ══ Reminder sheet ══ */}
      <SettingsSheet open={reminderSheet} onClose={() => setReminderSheet(false)} title="Training reminder">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 8 }}>
          <Row label="Enabled" first>
            <Toggle on={reminderEnabled} onToggle={() => { toggleReminder(); if (reminderEnabled) setReminderSheet(false); }} />
          </Row>
          {reminderEnabled && (
            <Row label="Notify at">
              <input type="time" value={reminderTime} onChange={e => updateReminderTime(e.target.value)}
                style={{ background: UI.bgInset, border: `var(--hair-width) solid ${UI.hairStrong}`, borderRadius: 4, padding: '5px 10px', color: UI.ink, fontFamily: UI.fontUi, fontSize: 13, outline: 'none', colorScheme: ['light', 'paper'].includes(store.settings?.darkMode ?? 'dark') ? 'light' : 'dark' }} />
            </Row>
          )}
          {reminderEnabled && store.nextReminderAt && (() => {
            const dt = new Date(store.nextReminderAt);
            const todayMid = new Date(); todayMid.setHours(0, 0, 0, 0);
            const tomorrowMid = new Date(todayMid); tomorrowMid.setDate(todayMid.getDate() + 1);
            const remMid = new Date(dt); remMid.setHours(0, 0, 0, 0);
            const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            const dateStr = remMid.getTime() === todayMid.getTime() ? 'Today' : remMid.getTime() === tomorrowMid.getTime() ? 'Tomorrow' : dt.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
            return <div className="micro" style={{ color: UI.inkFaint, textAlign: 'right', paddingTop: 6 }}>Next · {dateStr} · {timeStr}</div>;
          })()}
          <Btn onClick={() => setReminderSheet(false)}>Done</Btn>
        </div>
      </SettingsSheet>

      {/* ══ Test picker sheet (used from Advanced) ══ */}
      <SettingsSheet open={testPickerOpen} onClose={() => setTestPickerOpen(false)} title="Test rest timer">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testRestTimer(0); }}>Now</Btn>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testRestTimer(10); }}>In 10 seconds</Btn>
          <Btn kind="ghost" onClick={() => { setTestPickerOpen(false); testRestTimer(30); }}>In 30 seconds</Btn>
        </div>
      </SettingsSheet>

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />

    </Screen>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { SettingsScreen });
