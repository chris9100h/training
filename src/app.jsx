/* Main App, auth + routing */

const { useState: useStateA, useEffect: useEffectA, useRef: useRefA, useCallback: useCallbackA } = React;

// What's New, changelog entries live in src/whatsnew.js (window.WHATS_NEW, an
// array, newest first). On 'ready' after an update we show every entry the user
// hasn't seen yet, bundled into one card. Tracked per device by the newest id.
const WHATS_NEW_KEY = 'logbook-whatsnew-seen';

// How long markIntentionalSignOut() stays armed. A deliberate sign-out fires
// SIGNED_OUT within a moment; anything later is a different, involuntary event
// and must not be allowed to wipe the local pending diff.
const INTENTIONAL_SIGNOUT_TTL_MS = 30000;

const ADMIN_SUPPORT_EMAIL = 'office@btc-prime.biz';

// Entries newer than the last-seen id. New users / first run after the feature
// shipped (no stored id) get just the latest, not the whole back catalogue.
function unseenWhatsNew() {
  const all = window.WHATS_NEW || [];
  if (!all.length) return [];
  let seen = null;
  try { seen = localStorage.getItem(WHATS_NEW_KEY); } catch (_) {}
  if (!seen) return [all[0]];
  const idx = all.findIndex(e => e.id === seen);
  return idx === -1 ? [all[0]] : all.slice(0, idx); // newest-first: before the seen entry = unseen
}

// Recipe-share deep link (…/?share=<token>, see RecipeShareSheet in
// screens-food.jsx): stash the token BEFORE anything else runs, so it survives
// the login (or even signup + approval) roundtrip a logged-out recipient goes
// through, then scrub it from the URL so a later reload doesn't re-trigger.
// Consumed by the RecipeShareSheet overlay once the app is ready (store loaded);
// kept in localStorage until then and cleared only on actual consumption (sheet
// close), so a reload/kill during the logged-out recipient's sign-up + approval
// roundtrip re-reads the still-present token instead of losing the recipe. Worst
// case a share the user never closed re-offers on the next launch, harmless (the
// same account-agnostic recipe), which is the accepted cost of not losing it.
const PENDING_SHARE_KEY = 'logbook-pending-share';
try {
  const _shareToken = new URLSearchParams(window.location.search).get('share');
  if (_shareToken && /^[a-f0-9]{16,64}$/i.test(_shareToken)) {
    localStorage.setItem(PENDING_SHARE_KEY, _shareToken);
    window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }
} catch (_) {}

function useIsPad() {
  const [isPad, setIsPad] = useStateA(() => window.innerWidth >= 768);
  useEffectA(() => {
    const handler = () => setIsPad(window.innerWidth >= 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isPad;
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <Screen scroll={false} style={{ justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ textAlign: 'center', padding: 32, animation: 'fadeUp 0.4s ease' }}>
            <div style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600, marginBottom: 6 }}>
              Something went wrong
            </div>
            <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 20 }}>
              {this.state.error?.message || 'Unexpected error'}
            </div>
            <button
              onClick={() => { this.setState({ error: null }); this.props.onGoHome?.(); }}
              style={{ background: UI.gold, color: 'var(--accent-ink)', border: 'none', borderRadius: 4, padding: '8px 18px', fontSize: 13, fontWeight: 600, fontFamily: UI.fontUi, cursor: 'pointer', textShadow: 'none' }}
            >
              Back to home
            </button>
          </div>
        </Screen>
      );
    }
    return this.props.children;
  }
}

function AutoCloseBanner({ notify, onDismiss }) {
  const { dayName, date, durationMinutes } = notify;
  const dateLabel = date ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : '';
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'rgba(0,0,0,0.72)',
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 32,
    }}>
      <div style={{
        width: '100%', maxWidth: 320,
        background: UI.bgRaised,
        backgroundImage: 'var(--bg-texture)',
        border: `1px solid ${UI.hairStrong}`,
        borderRadius: 6,
        padding: '32px 28px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 10, textAlign: 'center',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
        animation: 'fadeUp 0.3s ease',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 6,
          background: UI.bgInset,
          border: `1px solid ${UI.hairStrong}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 6,
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={UI.inkFaint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, fontWeight: 400 }}>
          Session auto-ended
        </div>
        <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6 }}>
          Your <strong style={{ color: UI.ink }}>{dayName}</strong> session{dateLabel ? ` on ${dateLabel}` : ''} was automatically ended{durationMinutes != null ? <>, <strong style={{ color: UI.ink }}>{durationMinutes} min</strong> recorded</> : ''}.
        </div>
        <button onClick={onDismiss} style={{
          marginTop: 10, width: '100%', padding: '14px 0',
          borderRadius: 6, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
          boxShadow: '0 8px 24px rgba(var(--accent-rgb),0.4)',
          color: 'var(--accent-ink)', fontFamily: UI.fontUi, fontSize: 15, fontWeight: 700,
          letterSpacing: '0.06em', WebkitTapHighlightColor: 'transparent', textShadow: 'none',
        }}>
          GOT IT
        </button>
      </div>
    </div>
  );
}

// True while the onboarding flow still owns this boot's modal slot, i.e. the
// account has neither finished onboarding nor ever finished a session.
// Deliberately says nothing about settings.unit: an un-onboarded account
// reaches 'ready' with a null unit (the unit picker opens first, and the
// onboarding effect waits for it), so a unit test here would report "not
// onboarding" during exactly the window where onboarding has yet to decide.
function onboardingOwnsBoot(s) {
  return !!s && !s.settings?.onboardingCompleted && !(s.sessions || []).some(x => x.ended);
}

// Asks the worker CURRENTLY controlling this page for its own CACHE constant
// (sw.js answers GET_VERSION over the passed MessagePort). Resolves null when
// there is no controller, when MessageChannel is unavailable, or when the
// controller is an older sw.js with no GET_VERSION handler, in which case the
// message is simply ignored and the timeout below fires.
function askControllerSwVersion(timeoutMs = 1500) {
  return new Promise(resolve => {
    const ctrl = navigator.serviceWorker?.controller;
    if (!ctrl || typeof MessageChannel !== 'function') return resolve(null);
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      const ch = new MessageChannel();
      ch.port1.onmessage = (ev) => finish(typeof ev.data === 'string' ? ev.data : null);
      ctrl.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
    } catch (_) { finish(null); }
  });
}

// App-shell versions are intentionally monotonic. A late response from an old
// worker, or a briefly stale network read, must never move the durable marker
// backwards and turn that old version into a fresh update forever.
function compareSwVersions(a, b) {
  const parse = (value) => {
    const m = String(value || '').match(/^zane-v(\d+)\.(\d+)$/);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  return left[0] - right[0] || left[1] - right[1];
}

function isNewerSwVersion(candidate, current) {
  const compared = compareSwVersions(candidate, current);
  return compared == null ? candidate !== current : compared > 0;
}

function rememberAppliedSwVersion(version) {
  if (!version) return;
  try {
    const stored = localStorage.getItem('logbook-sw-version');
    if (!stored || isNewerSwVersion(version, stored)) {
      localStorage.setItem('logbook-sw-version', version);
    }
  } catch (_) {}
}

// Records which app-shell version is now actually running, so the banner is not
// re-offered for an update that has already been applied.
//
// Three sources in descending order of authority:
//  1. The controlling worker's own CACHE constant. Listing CacheStorage is NOT
//     a substitute: skipWaiting() hands control over as soon as the new worker
//     activates, before its activate handler's old-cache sweep has settled, so
//     at controllerchange both the old and the new key can still be present and
//     detectCacheVersion's `find` returns whichever CacheStorage enumerates
//     first, i.e. usually the OLD one. Recording that would re-offer the update
//     that was just applied, the exact symptom this function exists to stop.
//  2. `fallback`, normally pendingSwVersion: what checkSwUpdate actually read
//     off the network. Trustworthy, but only ever set on the checkSwUpdate
//     route, so the reg.waiting-at-boot and updatefound routes reach here with
//     nothing (and those are precisely the routes that carry an update applied
//     while offline, where the network check could not run).
//  3. CacheStorage, as a last resort for an old controller with no GET_VERSION
//     handler. detectCacheVersion strips the 'zane-' prefix; logbook-sw-version
//     stores the raw `const CACHE = '...'` string, hence putting it back on.
async function persistAppliedSwVersion(fallback) {
  let applied = await askControllerSwVersion();
  // During controllerchange the message can still reach the old worker for a
  // moment. The network version that triggered this update is the stronger
  // signal when it is newer than that response.
  if (fallback && (!applied || isNewerSwVersion(fallback, applied))) applied = fallback;
  if (!applied) {
    try {
      const version = await Promise.race([
        LB.detectCacheVersion(),
        new Promise(r => setTimeout(() => r(null), 1500)),
      ]);
      if (version) applied = 'zane-' + version;
    } catch (_) {}
  }
  rememberAppliedSwVersion(applied);
}

const DEFERRED_UPDATE_STORAGE = 'logbook-update-deferred';

function readDeferredUpdate() {
  try { return localStorage.getItem(DEFERRED_UPDATE_STORAGE); } catch (_) { return null; }
}

function isDeferredUpdateKey(key) {
  const deferred = readDeferredUpdate();
  return deferred === key || deferred === 'waiting';
}

function writeDeferredUpdate(value) {
  try {
    if (value) localStorage.setItem(DEFERRED_UPDATE_STORAGE, value);
    else localStorage.removeItem(DEFERRED_UPDATE_STORAGE);
  } catch (_) {}
}

function isTextEntryElement(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function UpdateBanner({ onUpdate, onDefer, updating, compact = false }) {
  if (compact) {
    return (
      <div style={{
        position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        left: 14, right: 14, zIndex: 9999,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 12px', borderRadius: 6,
        background: UI.bgRaised, backgroundImage: 'var(--bg-texture)',
        border: `1px solid ${UI.goldSoft}`,
        boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
        textShadow: 'var(--text-lift)',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: UI.ink, fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.06em' }}>
            UPDATE READY
          </div>
          <div style={{ color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, lineHeight: 1.35, marginTop: 2 }}>
            We will offer it again on Home when you are done here.
          </div>
        </div>
        <button onClick={onDefer} disabled={updating} style={{
          flexShrink: 0, padding: '8px 10px', borderRadius: 4,
          border: `1px solid ${UI.hairStrong}`, background: 'transparent',
          color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700,
          letterSpacing: '0.06em', cursor: updating ? 'default' : 'pointer',
          opacity: updating ? 0.45 : 1, textShadow: 'none',
        }}>
          LATER
        </button>
      </div>
    );
  }
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.72)',
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 32,
    }}>
      <div style={{
        width: '100%', maxWidth: 320,
        background: UI.bgRaised,
        backgroundImage: 'var(--bg-texture)',
        border: `1px solid ${UI.goldSoft}`,
        borderRadius: 6,
        padding: '32px 28px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 10, textAlign: 'center',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 var(--hair-width) rgba(var(--accent-rgb),0.2)',
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 6,
          background: UI.goldFaint,
          border: `1px solid ${UI.goldSoft}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 6,
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={UI.gold} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v10m0 0l-3-3m3 3l3-3"/><path d="M3 17v1a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-1"/>
          </svg>
        </div>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, fontWeight: 400 }}>
          New version available
        </div>
        <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
          A fresh update is ready to install. This only takes a second.
        </div>
        <button onClick={onUpdate} disabled={updating} style={{
          marginTop: 10, width: '100%', padding: '14px 0',
          borderRadius: 6, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
          boxShadow: '0 8px 24px rgba(var(--accent-rgb),0.4)',
          color: 'var(--accent-ink)', fontFamily: UI.fontUi, fontSize: 15, fontWeight: 700,
          letterSpacing: '0.06em', textShadow: 'none', opacity: updating ? 0.65 : 1,
        }}>
          {updating ? 'UPDATING...' : 'UPDATE NOW'}
        </button>
        <button onClick={onDefer} disabled={updating} style={{
          width: '100%', padding: '10px 0',
          borderRadius: 6, border: `1px solid ${UI.hairStrong}`,
          background: 'transparent', color: UI.inkSoft,
          fontFamily: UI.fontUi, fontSize: 12, fontWeight: 600,
          letterSpacing: '0.08em', cursor: updating ? 'default' : 'pointer',
          opacity: updating ? 0.45 : 1, textShadow: 'none',
        }}>
          LATER
        </button>
      </div>
    </div>
  );
}

function WhatsNewModal({ entries, onDismiss }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9997,
      background: 'rgba(0,0,0,0.72)',
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 32,
    }}>
      <div style={{
        width: '100%', maxWidth: 340, maxHeight: '82vh',
        background: UI.bgRaised,
        backgroundImage: 'var(--bg-texture)',
        border: `1px solid ${UI.goldSoft}`,
        borderRadius: 6,
        padding: '28px 26px',
        display: 'flex', flexDirection: 'column', gap: 18,
        overflowY: 'auto',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 var(--hair-width) rgba(var(--accent-rgb),0.2)',
        animation: 'fadeUp 0.3s ease',
        // This panel draws the same paper grid Card/Sheet do (bg-texture
        // above), so it needs the same lift or the grid cuts straight
        // through the title/item text. 'none' outside paper, a no-op there.
        textShadow: 'var(--text-lift)',
      }}>
        <div className="micro-gold">WHAT'S NEW</div>
        {entries.map((entry, ei) => (
          <div key={entry.id} style={{
            display: 'flex', flexDirection: 'column', gap: 12,
            ...(ei > 0 ? { paddingTop: 18, borderTop: `1px solid ${UI.hair}` } : null),
          }}>
            <div style={{ fontFamily: UI.fontDisplay, fontSize: 23, color: UI.ink, fontWeight: 400, lineHeight: 1.1 }}>
              {entry.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {/* An item is normally a plain string. { text, emphasis: true }
                  opts a single item into a bigger, bolder treatment, e.g. a
                  disclaimer that needs to stand out from the feature bullets
                  around it, every existing entry is a plain string and keeps
                  rendering exactly as before. */}
              {(entry.items || []).map((it, i) => {
                const emphasis = it && typeof it === 'object';
                const text = emphasis ? it.text : it;
                return (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: UI.gold, marginTop: emphasis ? 8 : 7, flexShrink: 0 }} />
                    <div style={{ fontSize: emphasis ? 15 : 13.5, fontWeight: emphasis ? 700 : 400, color: emphasis ? UI.ink : UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>{text}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <button onClick={onDismiss} style={{
          marginTop: 4, width: '100%', padding: '14px 0', flexShrink: 0,
          borderRadius: 6, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
          boxShadow: '0 8px 24px rgba(var(--accent-rgb),0.4)',
          color: 'var(--accent-ink)', fontFamily: UI.fontUi, fontSize: 15, fontWeight: 700,
          letterSpacing: '0.06em', WebkitTapHighlightColor: 'transparent', textShadow: 'none',
        }}>
          GOT IT
        </button>
      </div>
    </div>
  );
}


function LoadingScreen() {
  return (
    <Screen scroll={false} style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', animation: 'fadeUp 0.4s ease' }}>
        <div style={{
          width: 220, height: 220, margin: '0 auto 24px',
          animation: 'logoPulse 2.4s ease-in-out infinite',
        }}>
          <img src="icons/zane-logo.png" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: UI.ink, letterSpacing: '0.14em' }}>ZANE</div>
        <div style={{ fontSize: 11, color: UI.inkFaint, fontFamily: UI.fontNum, letterSpacing: '0.1em', marginTop: 10, animation: 'timerPulse 1.6s ease-in-out infinite' }}>
          Loading…
        </div>
      </div>
    </Screen>
  );
}

function ErrorScreen({ onRetry }) {
  return (
    <Screen scroll={false} style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ textAlign: 'center', padding: 32, animation: 'fadeUp 0.4s ease' }}>
        <div style={{ fontSize: 15, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600, marginBottom: 6 }}>
          Couldn't load your data
        </div>
        <div style={{ fontSize: 12, color: UI.inkFaint, fontFamily: UI.fontUi, marginBottom: 20 }}>
          Check your connection and try again.
        </div>
        <button onClick={onRetry} style={{
          background: UI.gold, color: 'var(--accent-ink)',
          border: 'none', borderRadius: 4,
          padding: '8px 18px', fontSize: 13, fontWeight: 600,
          fontFamily: UI.fontUi, cursor: 'pointer', textShadow: 'none',
        }}>
          Retry
        </button>
      </div>
    </Screen>
  );
}

const STAGED_BOOT_COLLECTIONS = [
  'exercises', 'schedules', 'skips', 'cardioLogs', 'cardioPlans', 'dailyLogs',
  'statusPeriods', 'waterLogs', 'foodLogs', 'foodFavorites', 'foodRecipes',
  'foodTemplateSlots', 'foodTemplateDays', 'foodMealPlans', 'foodShoppingPrefs',
  'medicationPlans', 'medications', 'medicationScheduleSlots', 'medicationLogs',
  'medicationPlanItems', 'medicationPillboxChecks', 'glucoseLogs',
  'bloodPressureLogs', 'bodyTempLogs', 'workoutTemplates',
  'checkinSchemaTemplates', 'mesoStates',
];

function mergeStagedCollection(key, freshRows, curRows, baseRows) {
  const serverIds = new Set((freshRows || []).map(row => row.id));
  const baseIds = new Set((baseRows || []).map(row => row.id));
  const currentIds = new Set((curRows || []).map(row => row.id));
  const deletedIds = new Set([...baseIds].filter(id => !currentIds.has(id)));
  const serverDates = key === 'dailyLogs' ? new Set((freshRows || []).map(row => row.date)) : null;
  const localOnly = (curRows || []).filter(row =>
    !serverIds.has(row.id) && !baseIds.has(row.id) && (!serverDates || !serverDates.has(row.date))
  );
  return [...localOnly, ...LB.mergeCollectionById(freshRows || [], curRows || [], baseRows || [], deletedIds)];
}

// Profile identity edits can happen while the staged boot payload is still
// hydrating. Merge only fields that changed locally; never let a stale local
// email/tier or an old cache without the new fields replace the fresh profile.
function mergeProfileIdentity(fresh, cur, base) {
  const merged = { ...(fresh || {}) };
  const keys = ['name', 'xHandle', 'xHandlePublic', 'xHandlePromptOptedOut'];
  if (!cur?.user) return merged;
  if (!base?.user) {
    if (cur.user.name) merged.name = cur.user.name;
    return merged;
  }
  for (const key of keys) {
    if (cur.user[key] !== undefined && JSON.stringify(cur.user[key]) !== JSON.stringify(base.user?.[key])) {
      merged[key] = cur.user[key];
    }
  }
  return merged;
}

// A first-install boot renders its essential payload while secondary tables
// hydrate. Any edit made during that short window must survive the full server
// response exactly like an edit made against the normal persisted cache.
function mergeStagedBootStore(fresh, cur, base) {
  if (!cur || !base) return fresh;
  const merged = { ...fresh };
  const inProgressId = LB.resolveInProgressId(cur, fresh, base);
  const sessionMerge = LB.mergeSessions(fresh.sessions || [], cur.sessions || [], inProgressId, base.sessions || []);
  merged.sessions = sessionMerge.sessions;
  merged.inProgress = sessionMerge.activeExists ? inProgressId : null;

  for (const key of STAGED_BOOT_COLLECTIONS) {
    merged[key] = mergeStagedCollection(key, fresh[key], cur[key], base[key]);
  }

  const stagedStatusPeriods = merged.statusPeriods;
  Object.assign(merged, LB.mergeBootScalars(fresh, cur, base, stagedStatusPeriods));
  const deviceOnlySettings = new Set(['darkMode', 'accentColor', 'swVersion', 'cycleWeekView', 'pushEnabled']);
  const settings = { ...(fresh.settings || {}) };
  const settingKeys = new Set([...Object.keys(fresh.settings || {}), ...Object.keys(cur.settings || {})]);
  for (const key of settingKeys) {
    const changedLocally = JSON.stringify(cur.settings?.[key]) !== JSON.stringify(base.settings?.[key]);
    if (deviceOnlySettings.has(key) || changedLocally) settings[key] = cur.settings?.[key];
  }
  merged.settings = settings;

  if (JSON.stringify(cur.nextReminderAt) !== JSON.stringify(base.nextReminderAt)) {
    merged.nextReminderAt = cur.nextReminderAt;
  }
  merged.user = mergeProfileIdentity(fresh.user, cur, base);
  merged.planDrafts = LB.mergePlanDrafts(fresh.planDrafts, cur.planDrafts, base.planDrafts);
  merged.adaptiveTdeeHistory = LB.mergeAdaptiveTdeeHistory(
    fresh.adaptiveTdeeHistory || [], cur.adaptiveTdeeHistory || []
  );
  // The admin support badge is an in-memory server-derived value, so it is not
  // present in either boot payload. Keep it when staged hydration replaces the
  // essential store after the app has already started rendering.
  if (Object.prototype.hasOwnProperty.call(cur, 'adminSupportUnread')) {
    merged.adminSupportUnread = cur.adminSupportUnread;
  }
  for (const key of Object.keys(cur)) {
    if (!(key in fresh) && JSON.stringify(cur[key]) !== JSON.stringify(base[key])) merged[key] = cur[key];
  }
  return merged;
}

function App() {
  const isPad = useIsPad();
  const [phase, setPhase]         = useStateA('init'); // 'init' | 'loading' | 'ready' | 'unauthed' | 'error' | 'invite'
  // Detect invite/password-reset link before Supabase clears the hash
  const isTokenFlow = useRefA(
    window.location.hash.includes('type=invite') || window.location.hash.includes('type=recovery')
  );
  const isRecoveryFlow = useRefA(window.location.hash.includes('type=recovery'));
  const recoveryInProgress = useRefA(false); // set by PASSWORD_RECOVERY event; guards loadData from overriding the reset screen
  const [store, setStore]         = useStateA(null);
  const [userId, setUserId]       = useStateA(null);
  const [route, setRoute]         = useStateA({ name: 'home' });
  const [runtimeConfig, setRuntimeConfig] = useStateA(() => LB.getCachedRuntimeConfig());
  const [updateAvailable, setUpdateAvailable] = useStateA(false);
  const [forceShowUpdateBanner, setForceShowUpdateBanner] = useStateA(false); // Settings test queues the banner for the next safe Home view
  const [updateApplying, setUpdateApplying] = useStateA(false);
  const [openSheetCount, setOpenSheetCount] = useStateA(0);
  const [textEntryFocused, setTextEntryFocused] = useStateA(false);
  const [autoCloseNotify, setAutoCloseNotify] = useStateA(null);
  const [whatsNew, setWhatsNew] = useStateA(null); // array of unseen changelog entries, or null
  const [whatsNewSettled, setWhatsNewSettled] = useStateA(false);
  const [xHandlePromptPending, setXHandlePromptPending] = useStateA(false);
  const [xHandlePromptOpen, setXHandlePromptOpen] = useStateA(false);
  const [syncStatus, setSyncStatus] = useStateA('synced'); // 'synced' | 'pending' | 'error'
  const [storageFull, setStorageFull] = useStateA(false);  // local cache write failed (quota)
  const [onboardingState, setOnboardingState] = useStateA(null); // null | { phase:'prompt' } | { phase:'tour', tourKey }
  const onboardingChecked = useRefA(false);
  // Live snapshot of store, read (not subscribed to) by the What's New effect
  // below so it can peek at the current onboarding-relevant fields without
  // adding store as a dependency, keeping it a run-once-per-ready effect
  // exactly like before whatsnew.js became a lazy load.
  const storeRefA = useRefA(store);
  storeRefA.current = store;
  // Support unread counts are UI state, not part of the persisted user store.
  // Keep a synchronous copy so a boot merge cannot race a realtime callback
  // that has not rendered yet.
  const adminSupportUnreadRef = useRefA(null);
  adminSupportUnreadRef.current = store?.adminSupportUnread ?? 0;
  const [unitPromptOpen, setUnitPromptOpen] = useStateA(false);
  const [pendingShare, setPendingShare] = useStateA(() => {   // ?share=<token> stashed by the module-scope block above
    try {
      // Read but do NOT remove here: the sheet only opens once `store` is ready
      // (see below), which for a logged-out recipient is after sign-up +
      // approval. Removing on first mount stranded the token in React state
      // only, so any reload/kill during that roundtrip (the common relaunch-
      // after-approval path) lost the recipe. Keeping it in localStorage lets a
      // fresh mount re-read it; it's cleared on actual consumption (sheet close).
      return localStorage.getItem(PENDING_SHARE_KEY);
    } catch (_) { return null; }
  });
  const unitPicked                = useRefA(false); // user chose a unit this session, silences the reset watcher
  const xHandlePromptCheckedUser  = useRefA(null); // once per user per boot, never re-prompt after onboarding completes in-place
  const retryTimer                = useRefA(null);  // one-shot retry after a failed sync
  const localSaveTimer            = useRefA(null);  // debounces the full-store localStorage write
  const waitingWorker             = useRefA(null);
  const intentionalUpdate         = useRefA(false);
  const updateApplyInFlight       = useRefA(false);
  const updateReloadStarted       = useRefA(false);
  const intentionalSignOut        = useRefA(null);  // ms timestamp, set right before a user-initiated LB.signOut() call
  const swReg                     = useRefA(null);
  const prevStore                 = useRefA(null);
  const syncBase                  = useRefA(null);  // last state confirmed written to Supabase
  const pendingStore              = useRefA(null);  // latest state awaiting sync
  const syncing                   = useRefA(false); // true while a sync is in flight
  const loadSeq                   = useRefA(0);     // generation counter: only the newest loadData may write
  const userIdRef                 = useRefA(null);  // current userId for stale-closure contexts
  const phaseRef                  = useRefA('init'); // current phase for stale-closure contexts
  const routeRef                  = useRefA({ name: 'home' }); // current route for stale-closure contexts
  const detectedSwVersion         = useRefA(null); // set as soon as caches.keys() resolves, applied once the store exists
  const pendingSwVersion          = useRefA(null); // newest sw.js version seen but not yet applied; persisted only by applyUpdate
  const pendingForceNonce         = useRefA(null); // admin_force_update() broadcast nonce seen but not yet applied
  const previousRouteName         = useRefA(null);
  const foregroundRefresh         = useRefA(null); // one in-flight health refresh across all foreground events
  const lastForegroundRefreshAt   = useRefA(0);    // start time of the last accepted soft refresh
  const lastForegroundEventAt     = useRefA(0);    // coalesces pageshow, visibility and focus bursts
  const stagedBootHydrating       = useRefA(false); // prevents feature-on effects duplicating stage two queries
  const previousMedsEnabled       = useRefA(null);
  const adminSupportUnreadRevision = useRefA(0);
  const adminSupportUnreadRequest  = useRefA(0);

  useEffectA(() => {
    userIdRef.current = userId;
    previousMedsEnabled.current = null;
    adminSupportUnreadRevision.current += 1;
    adminSupportUnreadRequest.current += 1;
    adminSupportUnreadRef.current = null;
  }, [userId]);
  useEffectA(() => { phaseRef.current = phase; }, [phase]);
  useEffectA(() => { routeRef.current = route; }, [route]);
  useEffectA(() => {
    const onRuntimeConfig = event => setRuntimeConfig(event.detail || LB.getCachedRuntimeConfig());
    window.addEventListener('zane-runtime-config', onRuntimeConfig);
    return () => window.removeEventListener('zane-runtime-config', onRuntimeConfig);
  }, []);

  // A route name alone cannot tell whether the Home screen is covered by a
  // quick-action sheet or whether a native field still owns the keyboard.
  // Sheet publishes its stack depth through this tiny app-wide signal so an
  // update can wait for a genuinely safe surface before reloading.
  useEffectA(() => {
    const syncSheetAndFocus = () => {
      const count = Number(window.__zaneOpenSheetCount || 0);
      const typing = isTextEntryElement(document.activeElement);
      setOpenSheetCount(n => n === count ? n : count);
      setTextEntryFocused(v => v === typing ? v : typing);
    };
    syncSheetAndFocus();
    window.addEventListener('zane-sheet-state', syncSheetAndFocus);
    window.addEventListener('focusin', syncSheetAndFocus);
    window.addEventListener('focusout', syncSheetAndFocus);
    return () => {
      window.removeEventListener('zane-sheet-state', syncSheetAndFocus);
      window.removeEventListener('focusin', syncSheetAndFocus);
      window.removeEventListener('focusout', syncSheetAndFocus);
    };
  }, []);
  useEffectA(() => {
    if (phase === 'ready') window.__startScreenWarmup?.();
  }, [phase]);

  // Support unread counts are intentionally not persisted, because they are a
  // server-derived inbox value. The revision guard prevents an RPC started
  // before a realtime note from overwriting the newer local increment.
  const refreshAdminSupportUnread = useCallbackA(() => {
    if (storeRefA.current?.user?.email !== ADMIN_SUPPORT_EMAIL) return Promise.resolve();
    const revision = adminSupportUnreadRevision.current;
    const request = ++adminSupportUnreadRequest.current;
    return LB.supabase.rpc('get_support_chats').then(({ data, error }) => {
      if (error || request !== adminSupportUnreadRequest.current || revision !== adminSupportUnreadRevision.current) return;
      const unread = (data || []).reduce((s, t) => s + Number(t.unread_count || 0), 0);
      adminSupportUnreadRef.current = unread;
      setStore(s => {
        if (!s || s.user?.email !== ADMIN_SUPPORT_EMAIL) return s;
        return (s.adminSupportUnread || 0) === unread ? s : { ...s, adminSupportUnread: unread };
      });
    }).catch(() => {});
  }, []);

  // Boot-time admin support unread count
  useEffectA(() => {
    if (store?.user?.email !== ADMIN_SUPPORT_EMAIL) return;
    refreshAdminSupportUnread();
  }, [store?.user?.email, refreshAdminSupportUnread]);

  // Reconcile once the admin returns to the foreground as a recovery path for
  // a realtime channel that was suspended while the tab was hidden.
  useEffectA(() => {
    if (store?.user?.email !== ADMIN_SUPPORT_EMAIL) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshAdminSupportUnread();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [store?.user?.email, refreshAdminSupportUnread]);

  // Auto-seed the system CARDIO exercise once per user (if missing or deleted).
  useEffectA(() => {
    if (phase !== 'ready' || !userId) return;
    setStore(s => {
      if (!s || (s.exercises || []).some(e => e.movement_type === 'cardio')) return s;
      const cardioEx = { id: LB.uid(), name: 'CARDIO', movement_type: 'cardio', tags: [], category: null, unilateral: false, no_weight_reps: false, equipment: null, note: '', progression_reps: null };
      return { ...s, exercises: [...(s.exercises || []), cardioEx] };
    });
  }, [phase, userId]);

  // Remove duplicate CARDIO exercises (cross-tab race condition: two tabs both seed
  // before either syncs to DB, resulting in two rows with different ids).
  useEffectA(() => {
    if (phase !== 'ready' || !userId || !store) return;
    const cardioExes = (store.exercises || []).filter(e => e.movement_type === 'cardio');
    if (cardioExes.length <= 1) return;
    const ids = cardioExes.map(e => e.id);
    // Which of the duplicates history actually points at has to come from the
    // SERVER, not from store.sessions: entries are only loaded for the boot
    // window, so an older reference reads as "unused" here and the dedup then
    // keeps cardioExes[0] (usually the freshly seeded row) and deletes the one
    // every logged cardio entry references.
    let cancelled = false;
    (async () => {
      const { data, error } = await LB.supabase.from('zane_session_entries').select('ex_id').eq('user_id', userId).in('ex_id', ids);
      // Deleting on a failed lookup could drop the referenced row. Leaving the
      // duplicate is harmless in comparison, the next boot retries.
      if (error || cancelled || userIdRef.current !== userId) return;
      const usedIds = new Set((data || []).map(r => r.ex_id));
      const keep = cardioExes.find(e => usedIds.has(e.id)) || cardioExes[0];
      const toDelete = cardioExes.filter(e => e.id !== keep.id && !usedIds.has(e.id)).map(e => e.id);
      if (!toDelete.length) return;
      const del = await LB.supabase.from('zane_exercises').delete().in('id', toDelete);
      if (del.error || cancelled) return;
      setStore(s => s ? { ...s, exercises: s.exercises.filter(e => !toDelete.includes(e.id)) } : s);
    })();
    return () => { cancelled = true; };
  }, [phase, userId]); // runs once on ready; store is captured from that render

  // One-time repair for a meal-of-choice entry confirmed before
  // confirmMealOfChoice (screens-food.jsx) gave it a real quantityG:
  // quantity_g is NOT NULL on zane_food_logs, so a local row still carrying
  // quantityG: null has been failing its sync on every retry since, forever,
  // wedging syncBase so every OTHER pending change behind it in the same
  // batch fails too, the standing "not synced" state this fixes. No row
  // shaped like this was ever valid server-side (the constraint would have
  // rejected it), so patching it locally to the same 100 fallback the fix
  // now uses is always safe. Runs at the app level, not inside the Food
  // screen, since the wedge blocks sync app-wide and must clear whether or
  // not the user ever opens Food again. Self-limiting without a localStorage
  // marker: once patched, the filter below no longer matches it.
  useEffectA(() => {
    if (phase !== 'ready' || !userId || !store) return;
    if ((store.foodLogs || []).every(l => l.quantityG != null)) return;
    setStore(s => (s ? { ...s, foodLogs: (s.foodLogs || []).map(l => l.quantityG == null ? { ...l, quantityG: 100 } : l) } : s));
  }, [phase, userId, store]);

  useEffectA(() => {
    const color = store?.settings?.accentColor;
    if (color) {
      window.applyAccentColor(color);
      // Guarded like every other localStorage write in this file: this one
      // sits in an App-level effect, above the per-screen ErrorBoundary, so
      // an unguarded quota/private-mode throw here (storageFull is already
      // an anticipated state, see saveToLocal) would crash the whole app
      // instead of just this effect's write.
      try { localStorage.setItem('logbook-accent-color', color); } catch (_) {}
    }
  }, [store?.settings?.accentColor]);

  useEffectA(() => {
    const mode = store?.settings?.darkMode;
    if (mode) {
      window.applyDarkMode(mode);
      try { localStorage.setItem('logbook-dark-mode', mode); } catch (_) {}
    }
  }, [store?.settings?.darkMode]);

  // Keeps the reminder clock fresh for every reminder cron (medication,
  // water, meal, daily-log) that places "now" on the user's local clock. Used
  // to be three separate per-screen writers (Water: only while that tab is
  // open, Food: only in Plan Mode, Meds: only while that tab is open), so a
  // user who never opened any of those three screens never got it written at
  // all, which is exactly the population the medication reminder's
  // server-side materialization (M8) was meant to help: it can now find a due
  // dose without the Meds tab ever having been opened, but was still firing
  // at the wrong local hour (UTC fallback) for that same user (M8-Rest,
  // audit-2026-08 verification). App-level instead so it fires for every
  // signed-in user regardless of navigation; only writes when it actually
  // changed (travel/DST). A single boot-time write was still stale by an hour
  // across a DST switch (and wrong across travel) while the app stayed open,
  // so the check also runs on every visibility return and on a 15-minute
  // timer: the crons read this column, they only need it correct around
  // their own fire times.
  useEffectA(() => {
    if (!store) return;
    // Functional setStore: the timer/visibility callbacks run long after this
    // effect's closure was created, so the comparison must read the LATEST
    // store, not the one captured here, and only write when it changed.
    const sync = () => {
      const off = -new Date().getTimezoneOffset();
      let zone = null;
      try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (_) {}
      setStore(s => {
        if (!s) return s;
        if (s.settings?.tzOffsetMinutes === off && s.settings?.timeZone === zone) return s;
        return { ...s, settings: { ...s.settings, tzOffsetMinutes: off, timeZone: zone } };
      });
    };
    sync();
    // 5-minute poll: the crons fire on fixed UTC schedules, so a longer
    // boot-anchored interval would leave the column stale for a whole
    // interval after a DST/travel change (a cron firing inside that window
    // would nudge at the wrong local hour/date). The check is a cheap
    // comparison that only writes on an actual change.
    const iv = setInterval(sync, 5 * 60 * 1000);
    const onVis = () => { if (!document.hidden) sync(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  }, [!!store]);

  // Report the active SW cache version to Supabase (so an admin can spot a
  // user stuck on a stale cache without asking them to check Settings).
  // Re-checked at boot, on every foreground and right when the cache
  // actually rotates (controllerchange), a single boot-time check isn't
  // enough since most users leave the PWA open for days without reloading.
  const reportSwVersion = useCallbackA(() => {
    LB.detectCacheVersion().then(version => {
      if (!version) return;
      detectedSwVersion.current = version;
      setStore(s => (s && s.settings?.swVersion !== version) ? { ...s, settings: { ...s.settings, swVersion: version } } : s);
    });
  }, [setStore]);

  // On a genuinely cold boot (fresh install/incognito), the SW can finish
  // activating, and this effect can fire, before login/data-load has
  // populated the store, so the setStore call above silently no-ops on a
  // null store with no retry. Flush the already-detected version the moment
  // the store actually becomes available.
  useEffectA(() => {
    if (!store || !detectedSwVersion.current) return;
    const version = detectedSwVersion.current;
    setStore(s => (s && s.settings?.swVersion !== version) ? { ...s, settings: { ...s.settings, swVersion: version } } : s);
  }, [!!store]);

  useEffectA(() => {
    const THRESHOLD      = 30 * 60 * 1000; // full reload after 30 min
    const SOFT_THRESHOLD = 30 * 1000; // data-only refresh after 30 s
    const KEY = 'logbook-bg-ts';

    const softRefresh = () => {
      const uid = userIdRef.current;
      if (phaseRef.current !== 'ready' || !uid) return;
      if (foregroundRefresh.current) return foregroundRefresh.current;
      const now = Date.now();
      if (now - lastForegroundRefreshAt.current < SOFT_THRESHOLD) return null;
      lastForegroundRefreshAt.current = now;
      const request = LB.refreshHealthLogs(uid, {
        medsEnabled: !!pendingStore.current?.settings?.medsEnabled,
      });
      foregroundRefresh.current = request;
      request.then(fresh => {
        if (!fresh) return;
        // Re-check after the await, not just before it started: a sign-out
        // (or a different user signing in) while this fetch was in flight
        // otherwise either crashes here on a null store (above the
        // per-screen ErrorBoundary, white-screening the whole app) or merges
        // this user's health/food/water/medication logs into a DIFFERENT
        // signed-in user's store, exactly the cross-account contamination
        // loadSeq guards against for loadData's own async path.
        if (userIdRef.current !== uid) return;
        setStore(s => {
          if (!s) return s;
          const serverDailyIds    = new Set(fresh.dailyLogs.map(l => l.id));
          const serverDailyDates  = new Set(fresh.dailyLogs.map(l => l.date));
          const serverCardioIds   = new Set(fresh.cardioLogs.map(l => l.id));
          const serverGlucoseIds  = new Set((fresh.glucoseLogs || []).map(l => l.id));
          const serverBpIds       = new Set((fresh.bloodPressureLogs || []).map(l => l.id));
          const serverTempIds     = new Set((fresh.bodyTempLogs || []).map(l => l.id));
          const serverWaterIds    = new Set((fresh.waterLogs || []).map(l => l.id));
          const serverFoodIds     = new Set((fresh.foodLogs || []).map(l => l.id));
          const serverMedPlanIds = new Set((fresh.medicationPlans || []).map(p => p.id));
          const serverMedIds = new Set((fresh.medications || []).map(m => m.id));
          const serverMedSlotIds = new Set((fresh.medicationScheduleSlots || []).map(s => s.id));
          const serverMedLogIds = new Set((fresh.medicationLogs || []).map(l => l.id));
          const serverMedPlanItemIds = new Set((fresh.medicationPlanItems || []).map(it => it.id));
          const serverMedPillboxCheckIds = new Set((fresh.medicationPillboxChecks || []).map(c => c.id));
          // For ids on both sides keep the local row when it carries an unsynced
          // edit (id in the persisted base AND local differs from base) so a
          // background refresh doesn't clobber a health edit made offline.
          const base = syncBase.current;
          // "local-only" must mean NEVER SYNCED, exactly like the boot merge:
          // a row that IS in the confirmed base but gone from the server was
          // deleted on another device, and re-adding it here resurrects it and
          // pushes it straight back. Without this test the hourly
          // collapse_water_logs cron also double-counted yesterday's water
          // (the collapsed raw rows came back next to their summary row).
          const baseIdSet = (baseRows) => (baseRows ? new Set(baseRows.map(r => r.id)) : null);
          const baseDailyIds   = baseIdSet(base?.dailyLogs);
          const baseCardioIds  = baseIdSet(base?.cardioLogs);
          const baseGlucoseIds = baseIdSet(base?.glucoseLogs);
          const baseBpIds      = baseIdSet(base?.bloodPressureLogs);
          const baseTempIds    = baseIdSet(base?.bodyTempLogs);
          const baseWaterIds   = baseIdSet(base?.waterLogs);
          const baseFoodIds    = baseIdSet(base?.foodLogs);
          const baseMedPlanIds = baseIdSet(base?.medicationPlans);
          const baseMedIds = baseIdSet(base?.medications);
          const baseMedSlotIds = baseIdSet(base?.medicationScheduleSlots);
          const baseMedLogIds = baseIdSet(base?.medicationLogs);
          const baseMedPlanItemIds = baseIdSet(base?.medicationPlanItems);
          const baseMedPillboxCheckIds = baseIdSet(base?.medicationPillboxChecks);
          // Daily logs are one-per-date: also drop a local row whose date the
          // server already has (a divergent id from a pre-RPC multi-device write).
          const localOnlyDaily   = (s.dailyLogs   || []).filter(l => !serverDailyIds.has(l.id) && !serverDailyDates.has(l.date) && !baseDailyIds?.has(l.id));
          const localOnlyCardio  = (s.cardioLogs  || []).filter(l => !serverCardioIds.has(l.id) && !baseCardioIds?.has(l.id));
          const localOnlyGlucose = (s.glucoseLogs || []).filter(l => !serverGlucoseIds.has(l.id) && !baseGlucoseIds?.has(l.id));
          const localOnlyBp      = (s.bloodPressureLogs || []).filter(l => !serverBpIds.has(l.id) && !baseBpIds?.has(l.id));
          const localOnlyTemp    = (s.bodyTempLogs || []).filter(l => !serverTempIds.has(l.id) && !baseTempIds?.has(l.id));
          const localOnlyWater   = (s.waterLogs || []).filter(l => !serverWaterIds.has(l.id) && !baseWaterIds?.has(l.id));
          const localOnlyFood    = (s.foodLogs || []).filter(l => !serverFoodIds.has(l.id) && !baseFoodIds?.has(l.id));
          const localOnlyMedPlans = (s.medicationPlans || []).filter(l => !serverMedPlanIds.has(l.id) && !baseMedPlanIds?.has(l.id));
          const localOnlyMeds = (s.medications || []).filter(l => !serverMedIds.has(l.id) && !baseMedIds?.has(l.id));
          const localOnlyMedSlots = (s.medicationScheduleSlots || []).filter(l => !serverMedSlotIds.has(l.id) && !baseMedSlotIds?.has(l.id));
          const localOnlyMedLogs = (s.medicationLogs || []).filter(l => !serverMedLogIds.has(l.id) && !baseMedLogIds?.has(l.id));
          const localOnlyMedPlanItems = (s.medicationPlanItems || []).filter(l => !serverMedPlanItemIds.has(l.id) && !baseMedPlanItemIds?.has(l.id));
          const localOnlyMedPillboxChecks = (s.medicationPillboxChecks || []).filter(l => !serverMedPillboxCheckIds.has(l.id) && !baseMedPillboxCheckIds?.has(l.id));
          // Locally-deleted-but-unsynced rows (in base, gone from local): filter
          // them out of fresh so the background refresh doesn't resurrect a log
          // the user just deleted before the delete reached the server (audit
          // B3, the boot merge already does this; softRefresh was missing it).
          const delDel = (baseRows, curRows) => {
            if (!baseRows) return null;
            const curIds = new Set((curRows || []).map(r => r.id));
            return new Set(baseRows.map(r => r.id).filter(id => !curIds.has(id)));
          };
          const delDaily   = delDel(base?.dailyLogs,   s.dailyLogs);
          const delCardio  = delDel(base?.cardioLogs,  s.cardioLogs);
          const delGlucose = delDel(base?.glucoseLogs, s.glucoseLogs);
          const delBp      = delDel(base?.bloodPressureLogs, s.bloodPressureLogs);
          const delTemp    = delDel(base?.bodyTempLogs, s.bodyTempLogs);
          const delWater   = delDel(base?.waterLogs, s.waterLogs);
          const delFood    = delDel(base?.foodLogs, s.foodLogs);
          const delMedPlans = delDel(base?.medicationPlans, s.medicationPlans);
          const delMeds = delDel(base?.medications, s.medications);
          const delMedSlots = delDel(base?.medicationScheduleSlots, s.medicationScheduleSlots);
          const delMedLogs = delDel(base?.medicationLogs, s.medicationLogs);
          const delMedPlanItems = delDel(base?.medicationPlanItems, s.medicationPlanItems);
          const delMedPillboxChecks = delDel(base?.medicationPillboxChecks, s.medicationPillboxChecks);
          const nextDaily   = [...localOnlyDaily,   ...LB.mergeCollectionById(fresh.dailyLogs, s.dailyLogs, base?.dailyLogs, delDaily)];
          const nextCardio  = [...localOnlyCardio,  ...LB.mergeCollectionById(fresh.cardioLogs, s.cardioLogs, base?.cardioLogs, delCardio)];
          const nextGlucose = [...localOnlyGlucose, ...LB.mergeCollectionById(fresh.glucoseLogs || [], s.glucoseLogs, base?.glucoseLogs, delGlucose)];
          const nextBp      = [...localOnlyBp,      ...LB.mergeCollectionById(fresh.bloodPressureLogs || [], s.bloodPressureLogs, base?.bloodPressureLogs, delBp)];
          const nextTemp    = [...localOnlyTemp,    ...LB.mergeCollectionById(fresh.bodyTempLogs || [], s.bodyTempLogs, base?.bodyTempLogs, delTemp)];
          const nextWater   = [...localOnlyWater,   ...LB.mergeCollectionById(fresh.waterLogs || [], s.waterLogs, base?.waterLogs, delWater)];
          const nextFood    = [...localOnlyFood,    ...LB.mergeCollectionById(fresh.foodLogs || [], s.foodLogs, base?.foodLogs, delFood)];
          const nextMedPlans = fresh.medicationsLoaded ? [...localOnlyMedPlans, ...LB.mergeCollectionById(fresh.medicationPlans || [], s.medicationPlans, base?.medicationPlans, delMedPlans)] : (s.medicationPlans || []);
          const nextMeds = fresh.medicationsLoaded ? [...localOnlyMeds, ...LB.mergeCollectionById(fresh.medications || [], s.medications, base?.medications, delMeds)] : (s.medications || []);
          const nextMedSlots = fresh.medicationsLoaded ? [...localOnlyMedSlots, ...LB.mergeCollectionById(fresh.medicationScheduleSlots || [], s.medicationScheduleSlots, base?.medicationScheduleSlots, delMedSlots)] : (s.medicationScheduleSlots || []);
          const nextMedLogs = fresh.medicationsLoaded ? [...localOnlyMedLogs, ...LB.mergeCollectionById(fresh.medicationLogs || [], s.medicationLogs, base?.medicationLogs, delMedLogs)] : (s.medicationLogs || []);
          const nextMedPlanItems = fresh.medicationsLoaded ? [...localOnlyMedPlanItems, ...LB.mergeCollectionById(fresh.medicationPlanItems || [], s.medicationPlanItems, base?.medicationPlanItems, delMedPlanItems)] : (s.medicationPlanItems || []);
          const nextMedPillboxChecks = fresh.medicationsLoaded ? [...localOnlyMedPillboxChecks, ...LB.mergeCollectionById(fresh.medicationPillboxChecks || [], s.medicationPillboxChecks, base?.medicationPillboxChecks, delMedPillboxChecks)] : (s.medicationPillboxChecks || []);
          // refreshHealthLogs re-maps every row into a fresh object, so these
          // merged arrays are new references even when nothing actually changed,
          // which forced a full re-render of the active screen on EVERY
          // foreground (the reported reactivation stutter). Bail out when content
          // is unchanged, and keep each unchanged collection's previous reference
          // so its downstream useMemos don't needlessly recompute either.
          const sameLogs = (a, b) => (a || []).length === (b || []).length &&
            (a || []).every((x, i) => x === b[i] || JSON.stringify(x) === JSON.stringify(b[i]));
          const dSame = sameLogs(nextDaily, s.dailyLogs);
          const cSame = sameLogs(nextCardio, s.cardioLogs);
          const gSame = sameLogs(nextGlucose, s.glucoseLogs);
          const bpSame = sameLogs(nextBp, s.bloodPressureLogs);
          const tSame = sameLogs(nextTemp, s.bodyTempLogs);
          const wSame = sameLogs(nextWater, s.waterLogs);
          const fSame = sameLogs(nextFood, s.foodLogs);
          const medPlansSame = sameLogs(nextMedPlans, s.medicationPlans);
          const medsSame = sameLogs(nextMeds, s.medications);
          const medSlotsSame = sameLogs(nextMedSlots, s.medicationScheduleSlots);
          const medLogsSame = sameLogs(nextMedLogs, s.medicationLogs);
          const medPlanItemsSame = sameLogs(nextMedPlanItems, s.medicationPlanItems);
          const medPillboxChecksSame = sameLogs(nextMedPillboxChecks, s.medicationPillboxChecks);
          if (dSame && cSame && gSame && bpSame && tSame && wSame && fSame
              && medPlansSame && medsSame && medSlotsSame && medLogsSame && medPlanItemsSame && medPillboxChecksSame) return s;
          return { ...s,
            dailyLogs:   dSame ? s.dailyLogs : nextDaily,
            cardioLogs:  cSame ? s.cardioLogs : nextCardio,
            glucoseLogs: gSame ? s.glucoseLogs : nextGlucose,
            bloodPressureLogs: bpSame ? s.bloodPressureLogs : nextBp,
            bodyTempLogs: tSame ? s.bodyTempLogs : nextTemp,
            waterLogs: wSame ? s.waterLogs : nextWater,
            foodLogs: fSame ? s.foodLogs : nextFood,
            medicationPlans: medPlansSame ? s.medicationPlans : nextMedPlans,
            medications: medsSame ? s.medications : nextMeds,
            medicationScheduleSlots: medSlotsSame ? s.medicationScheduleSlots : nextMedSlots,
            medicationLogs: medLogsSame ? s.medicationLogs : nextMedLogs,
            medicationPlanItems: medPlanItemsSame ? s.medicationPlanItems : nextMedPlanItems,
            medicationPillboxChecks: medPillboxChecksSame ? s.medicationPillboxChecks : nextMedPillboxChecks,
          };
        });
      }).catch(() => {}).finally(() => {
        if (foregroundRefresh.current === request) foregroundRefresh.current = null;
      });
      return request;
    };

    const onHide = () => { try { localStorage.setItem(KEY, Date.now()); } catch (_) {} };
    const handleForeground = () => {
      if (document.hidden) return;
      if (routeRef.current?.name === 'train') return;
      const now = Date.now();
      if (now - lastForegroundEventAt.current < 500) return;
      lastForegroundEventAt.current = now;
      let ts = null;
      try { ts = localStorage.getItem(KEY); } catch (_) {}
      const elapsed = ts ? Date.now() - Number(ts) : 0;
      if (elapsed > THRESHOLD) { window.location.reload(); return; }
      if (elapsed > SOFT_THRESHOLD) softRefresh();
      swReg.current?.update().catch(() => {});
      reportSwVersion();
    };
    const onShow = (e) => { if (e.persisted) handleForeground(); };
    const onVisibility = () => {
      if (document.hidden) {
        onHide();
      } else {
        handleForeground();
      }
    };

    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    window.addEventListener('focus', handleForeground);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('focus', handleForeground);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // A user can turn Medications back on without reloading. Since disabled
  // accounts no longer fetch those six tables at boot, hydrate them once on
  // the false-to-true transition while sharing the foreground request lock.
  useEffectA(() => {
    const enabled = !!store?.settings?.medsEnabled;
    const wasEnabled = previousMedsEnabled.current;
    previousMedsEnabled.current = enabled;
    if (phase !== 'ready' || !userId || wasEnabled !== false || !enabled || stagedBootHydrating.current) return;
    let cancelled = false;
    const hydrate = () => {
      if (cancelled || !userIdRef.current || foregroundRefresh.current) return;
      const uid = userIdRef.current;
      const request = LB.refreshHealthLogs(uid, { medsEnabled: true });
      foregroundRefresh.current = request;
      lastForegroundRefreshAt.current = Date.now();
      request.then(fresh => {
        if (cancelled || !fresh?.medicationsLoaded || userIdRef.current !== uid) return;
        setStore(current => {
          if (!current) return current;
          const base = syncBase.current;
          return {
            ...current,
            medicationPlans: mergeStagedCollection('medicationPlans', fresh.medicationPlans, current.medicationPlans, base?.medicationPlans),
            medications: mergeStagedCollection('medications', fresh.medications, current.medications, base?.medications),
            medicationScheduleSlots: mergeStagedCollection('medicationScheduleSlots', fresh.medicationScheduleSlots, current.medicationScheduleSlots, base?.medicationScheduleSlots),
            medicationLogs: mergeStagedCollection('medicationLogs', fresh.medicationLogs, current.medicationLogs, base?.medicationLogs),
            medicationPlanItems: mergeStagedCollection('medicationPlanItems', fresh.medicationPlanItems, current.medicationPlanItems, base?.medicationPlanItems),
            medicationPillboxChecks: mergeStagedCollection('medicationPillboxChecks', fresh.medicationPillboxChecks, current.medicationPillboxChecks, base?.medicationPillboxChecks),
          };
        });
      }).catch(() => {}).finally(() => {
        if (foregroundRefresh.current === request) foregroundRefresh.current = null;
      });
    };
    const pending = foregroundRefresh.current;
    if (pending) pending.then(hydrate, hydrate);
    else hydrate();
    return () => { cancelled = true; };
  }, [phase, userId, store?.settings?.medsEnabled]);

  // Dismiss already-shown notifications whenever the app is in the foreground.
  // TTL on the push only governs *undelivered* messages; notifications that
  // were shown while you were away keep piling up in the OS notification center
  // otherwise. Returning to the app (visibilitychange) is the moment to clear
  // them, it covers the "just logged a set" case and stale coaching pushes.
  useEffectA(() => {
    if (!('serviceWorker' in navigator)) return;
    const clearDelivered = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.serviceWorker.ready
        .then(reg => reg.getNotifications())
        .then(ns => ns.forEach(n => n.close()))
        .catch(() => {});
    };
    clearDelivered();
    document.addEventListener('visibilitychange', clearDelivered);
    return () => document.removeEventListener('visibilitychange', clearDelivered);
  }, []);

  const deferUpdate = useCallbackA(() => {
    // The local test banner has no real pending version. It is only a preview
    // of the UI, so closing it should not create a phantom update reminder.
    if (forceShowUpdateBanner && !updateAvailable) {
      setForceShowUpdateBanner(false);
      return;
    }
    const key = pendingSwVersion.current
      || (pendingForceNonce.current ? `force:${pendingForceNonce.current}` : 'waiting');
    writeDeferredUpdate(key);
    setUpdateAvailable(false);
    setForceShowUpdateBanner(false);
  }, [forceShowUpdateBanner, updateAvailable]);

  // All successful handoffs, including the timeout recovery path, use this
  // single gate. The old flow had one reload in controllerchange and another
  // in applyUpdate's timeout branch, so a fast controllerchange could trigger
  // two navigations for one tap.
  const reloadAfterUpdate = useCallbackA(() => {
    if (updateReloadStarted.current) return;
    updateReloadStarted.current = true;
    writeDeferredUpdate(null);
    persistAppliedSwVersion(pendingSwVersion.current)
      .finally(() => window.location.reload());
  }, []);

  useEffectA(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(reg => {
      swReg.current = reg;
      reg.update().catch(() => {});
      reportSwVersion();
      const trackWorker = (worker) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') {
            waitingWorker.current = worker;
            const key = pendingSwVersion.current
              || (pendingForceNonce.current ? `force:${pendingForceNonce.current}` : 'waiting');
            if (!isDeferredUpdateKey(key)) setUpdateAvailable(true);
          }
        });
      };
      if (reg.waiting) {
        // A boot that directly follows a deliberate cache wipe (clearCachesAndReload
        // stamps zane-cold-boot) must not prompt: the reload already fetched the new
        // code from the network, the old worker is simply still the registered one and
        // has re-installed the update into `waiting`. The user asked for exactly this
        // update moments ago, so take the worker silently. onControllerChange then
        // records the version without reloading, because intentionalUpdate is false.
        let coldBoot = false;
        try { coldBoot = window.__ZANE_COLD_BOOT === true; } catch (_) {}
        if (coldBoot) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        } else {
          waitingWorker.current = reg.waiting;
          const key = pendingSwVersion.current
            || (pendingForceNonce.current ? `force:${pendingForceNonce.current}` : 'waiting');
          if (!isDeferredUpdateKey(key)) setUpdateAvailable(true);
        }
      } else if (!reg.installing) {
        // Nothing pending: whatever controls this page right now IS the current
        // version, so record it. Without this, an update that activated while no
        // tab was open (or during a boot whose network version check failed) left
        // logbook-sw-version stale forever, and the next successful check raised a
        // banner for an update that had already been applied.
        persistAppliedSwVersion(null);
      }
      reg.addEventListener('updatefound', () => trackWorker(reg.installing));
    });
    // Only reload when the user explicitly clicked "Update now", but every
    // tab (not just the one that triggered it) gets this event the instant
    // the new SW takes control and rotates the cache, so it's the most
    // precise moment to re-check the version even for tabs that don't reload.
    const onControllerChange = () => {
      reportSwVersion();
      // Recording which version now controls the page is plain fact-keeping and
      // is therefore done unconditionally, whoever triggered the change (this
      // tab's banner tap, another tab's, or the silent cold-boot handoff above).
      // Only the RELOAD is gated on this tab having asked for it. Persisting
      // here rather than on the click is what keeps an update that never
      // activates (tab closed, SKIP_WAITING lost) being re-offered later.
      if (intentionalUpdate.current) reloadAfterUpdate();
      else persistAppliedSwVersion(pendingSwVersion.current);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  const applyUpdate = useCallbackA(async () => {
    if (updateApplyInFlight.current || updateReloadStarted.current) return;
    updateApplyInFlight.current = true;
    setUpdateApplying(true);
    setUpdateAvailable(false);
    setForceShowUpdateBanner(false);

    // A force-update broadcast (admin_force_update) isn't tied to an actual
    // SW change, so there's no "wait for activation" step to persist it
    // after, clicking Update always leads to a fresh reload one way or
    // another (real SW takeover or the clearCachesAndReload fallback below),
    // so mark it seen right away.
    if (pendingForceNonce.current) {
      try { localStorage.setItem('logbook-force-nonce-seen', pendingForceNonce.current); } catch (_) {}
    }
    // The applied version is persisted in onControllerChange (once the new SW
    // takes control), never on mere detection or click, so a not-yet-activated
    // update keeps being re-offered across cold starts.
    // Don't delete caches when we successfully hand off to a real worker
    // below: the new SW's install already populated its CACHE, and its
    // activate handler deletes every other (old) cache. Wiping all caches
    // here too, including the freshly-installed one, would force a full
    // network refetch and break offline right after an update.

    // Prefer the worker we already tracked; fall back to live reg state
    let worker = waitingWorker.current ?? swReg.current?.waiting;

    if (!worker && swReg.current) {
      // New SW might still be installing, wait up to 6 s for it to reach waiting
      const installing = swReg.current.installing;
      if (installing) {
        worker = await new Promise(resolve => {
          const t = setTimeout(() => resolve(null), 6000);
          installing.addEventListener('statechange', function h() {
            if (installing.state === 'installed') {
              installing.removeEventListener('statechange', h);
              clearTimeout(t);
              resolve(swReg.current?.waiting ?? installing);
            }
          });
        });
      }
    }

    let activatedViaWorker = false;
    if (worker) {
      const controllerBefore = navigator.serviceWorker.controller;
      const waitingBefore = swReg.current?.waiting || null;
      intentionalUpdate.current = true;
      // Register before posting. A fast worker can claim this page in the same
      // turn; registering afterwards was the second half of the double-reload
      // race because the global handler saw controllerchange while this local
      // timeout path missed it.
      const activation = new Promise(resolve => {
        const t = setTimeout(() => {
          navigator.serviceWorker.removeEventListener('controllerchange', h);
          resolve(false);
        }, 8000);
        function h() {
          navigator.serviceWorker.removeEventListener('controllerchange', h);
          clearTimeout(t);
          resolve(true);
        }
        navigator.serviceWorker.addEventListener('controllerchange', h);
      });
      worker.postMessage({ type: 'SKIP_WAITING' });
      // skipWaiting()/clients.claim() should fire 'controllerchange' back on
      // this page almost immediately, but a backgrounded/suspended tab (iOS
      // throttles a PWA the instant it loses foreground, which can happen
      // right after this tap) can swallow that event entirely: intentionalUpdate
      // stays true forever with nothing to reload it, and the version is never
      // persisted, so the next foreground/route check (checkSwUpdate) sees the
      // exact same "new" version again and re-shows the banner, forever
      // (confirmed: this produced a repeating update-banner loop). Race a
      // timeout against the real event so this path always resolves.
      activatedViaWorker = await activation;
      // A timeout is NOT proof the handoff failed. The suspended-page case this
      // exists for swallows the event while the worker activates normally with
      // a fully populated cache, and falling through to the wipe below would
      // then delete exactly the fresh cache the comment above says to protect
      // (and strand an offline user on sw.js's empty-bodied ?_v= fallback).
      // So re-read the real state: a moved controller, or the worker we posted
      // to having left the waiting slot, both mean skipWaiting took and a plain
      // reload lands on the new worker. onControllerChange never ran in that
      // case, so do its job here instead of letting the update strand.
      if (!activatedViaWorker) {
        const controllerNow = navigator.serviceWorker.controller;
        const controllerMoved = !!controllerNow && controllerNow !== controllerBefore;
        // The waiting slot emptying is only evidence of a SUCCESSFUL handoff if
        // the worker we posted to actually reached 'activating'/'activated'. It
        // also empties when that worker goes 'redundant' (the browser evicted
        // it, or a newer install replaced it), and treating that as success
        // would skip the cache wipe and do a plain reload that the still-active
        // OLD worker answers cache-first from the OLD cache: the user taps
        // Update and gets the same app back, with no path forward.
        const waitingCleared = !!waitingBefore
          && swReg.current?.waiting !== waitingBefore
          && waitingBefore.state !== 'redundant'
          && waitingBefore.state !== 'installed';
        if (controllerMoved || waitingCleared) {
          reloadAfterUpdate();
          return;
        }
      }
    }
    if (!activatedViaWorker) {
      // Either no installed/waiting worker turned up in time (our own faster
      // text-based update check, checkSwUpdate, can show the banner before the
      // browser's native SW update/install has caught up, or install may still
      // be running past the 6s wait above), or one did but never actually took
      // control (see the timeout above). A bare reload here would hit the OLD
      // SW's stale-while-revalidate fetch handler and instantly re-serve the
      // cached (old) app, the update button would look like it does nothing.
      // Wipe the cache first, exactly like the "Reload App" quick action does,
      // so the reload is guaranteed to actually fetch fresh code instead of
      // silently staying on the old one.
      // Persist the version we're about to fetch fresh, otherwise
      // checkSwUpdate sees the same "new" version again right after reload
      // and re-shows the banner, forever (confirmed: this caused an
      // infinite update-banner loop whenever this fallback path was taken).
      if (pendingSwVersion.current) {
        try { localStorage.setItem('logbook-sw-version', pendingSwVersion.current); } catch (_) {}
      }
      writeDeferredUpdate(null);
      await LB.clearCachesAndReload();
    }
  }, []);

  const cancelScheduledLocalSave = useCallbackA(() => {
    const task = localSaveTimer.current;
    if (!task) return;
    if (task.debounceId != null) clearTimeout(task.debounceId);
    if (task.idleId != null) {
      if (task.idleIsTimeout) clearTimeout(task.idleId);
      else if (typeof cancelIdleCallback === 'function') cancelIdleCallback(task.idleId);
    }
    localSaveTimer.current = null;
  }, []);

  const persistLocalNow = useCallbackA(() => {
    cancelScheduledLocalSave();
    const uid = userIdRef.current;
    const target = pendingStore.current;
    if (!uid || !target) return true;
    const ok = LB.saveLocalState(target, syncBase.current, uid);
    if (!ok) setStorageFull(true);
    return ok;
  }, [cancelScheduledLocalSave]);

  const scheduleLocalSave = useCallbackA((delay = 300) => {
    cancelScheduledLocalSave();
    const task = { debounceId: null, idleId: null, idleIsTimeout: false };
    task.debounceId = setTimeout(() => {
      task.debounceId = null;
      const run = () => {
        if (localSaveTimer.current !== task) return;
        localSaveTimer.current = null;
        const uid = userIdRef.current;
        const target = pendingStore.current;
        if (uid && target && !LB.saveLocalState(target, syncBase.current, uid)) setStorageFull(true);
      };
      if (typeof requestIdleCallback === 'function') {
        task.idleId = requestIdleCallback(run, { timeout: 1200 });
      } else {
        task.idleIsTimeout = true;
        task.idleId = setTimeout(run, 0);
      }
    }, delay);
    localSaveTimer.current = task;
  }, [cancelScheduledLocalSave]);

  // Push pending local changes to Supabase. Serialized; on failure syncBase is
  // left untouched so the next change (or an 'online' event) retries the diff.
  const flushSync = useCallbackA((uid) => {
    // Never write for a uid that is no longer the current user. A retry timer
    // scheduled with the old uid could otherwise fire after an account switch
    // and upsert one account's data stamped with another's user_id.
    if (uid !== userIdRef.current) return;
    if (syncing.current) return;
    const target = pendingStore.current;
    if (!target || target === syncBase.current || !uid) return;
    syncing.current = true;
    let ok = false;
    LB.syncStore(syncBase.current, target, uid)
      .then(() => { syncBase.current = target; scheduleLocalSave(0); ok = true; })
      .catch(err => console.error('Supabase sync failed, will retry', err))
      .finally(() => {
        syncing.current = false;
        if (ok) {
          // More edits landed mid-flight? Keep flushing. Otherwise we're synced.
          if (pendingStore.current !== syncBase.current) { setSyncStatus('pending'); flushSync(uid); }
          else setSyncStatus('synced');
        } else {
          // syncStore now throws on a real write failure (see unwrap). Surface
          // it and schedule a retry, the 'online' listener also retries.
          setSyncStatus('error');
          clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => flushSync(uid), 15000);
        }
      });
  }, [scheduleLocalSave]);

  // One-shot, awaitable flush for the sign-out flow. Unlike flushSync (fire-
  // and-forget, auto-retried on a 15s timer), SIGNED_OUT wipes the local
  // cache/pending diff unconditionally and immediately (see below): if that
  // races an unsynced change (e.g. a flex-plan cycle advance from finishing
  // today's workout seconds before tapping Sign out), the change is lost with
  // no local record to retry from on the next login. Callers must await this
  // BEFORE calling LB.signOut(), while the session is still valid: a flush
  // attempted reactively inside the SIGNED_OUT handler would already be
  // fighting a session Supabase is in the middle of invalidating. Bounded so
  // a dead network can't hang the sign-out button.
  // Returns whether the pending diff is safely on the server: true when it
  // landed (or when there was nothing to flush), false on timeout and on a
  // failed write. Callers MUST NOT arm the wipe latch on false, the local
  // cache is then the only remaining copy of the change.
  const flushBeforeSignOut = useCallbackA(async (uid) => {
    // Not the current user any more: this diff must never be written (same
    // reason as in flushSync), so whatever is pending stays unflushed. Report
    // failure, the caller then keeps the local cache instead of wiping it.
    if (uid !== userIdRef.current) return false;
    const target = pendingStore.current;
    // Nothing pending: there is no unsynced change a wipe could destroy.
    if (!target || target === syncBase.current || !uid) return true;
    // Only the sync path sets this. The timeout ends the WAIT, it can never
    // report success: without the flag, a 5s stall resolved the race exactly
    // like a completed write (and so did the catch below), the caller wiped
    // the local cache, and the change was gone with nothing left to retry.
    let landed = false;
    const timeout = new Promise(resolve => setTimeout(resolve, 5000));
    try {
      await Promise.race([
        LB.syncStore(syncBase.current, target, uid).then(() => {
          syncBase.current = target;
          if (!LB.saveSyncedState(target, uid)) setStorageFull(true);
          landed = true;
        }),
        timeout,
      ]);
    } catch (err) {
      console.error('flushBeforeSignOut: final sync attempt failed', err);
    }
    return landed;
  }, []);

  // Arms the SIGNED_OUT handler below to actually wipe local storage. Must be
  // called synchronously right before every deliberate LB.signOut(), without
  // it, SIGNED_OUT is treated as involuntary (failed refresh, revoked/expired
  // session, dead network) and the local cache/pending diff is preserved.
  const markIntentionalSignOut = useCallbackA(() => { intentionalSignOut.current = Date.now(); }, []);

  const loadData = async (uid) => {
    // Generation stamp: SIGNED_OUT and every newer loadData bump this, and
    // nothing below writes to the store, the diff base or the local cache
    // unless it is still the newest load for the CURRENT user. Without it a
    // slow loadFromSupabase(A) resolving after user B signed in on the same
    // page session merged A's exercises, plans and history into B's store and
    // persisted the mix into B's local cache.
    const seq = ++loadSeq.current;
    const isStale = () => seq !== loadSeq.current || uid !== userIdRef.current;
    const localState = LB.loadLocalState(uid);
    const cached = localState.store;
    if (cached) {
      // Show instantly from cache, then refresh from Supabase in background
      prevStore.current = cached;
      // base = last state confirmed written to Supabase. Lets the merge below
      // tell apart locally-changed-but-unsynced settings from server state.
      const base = localState.base;
      syncBase.current = base || cached;
      setStore(cached);
      setPhase('ready');
      // Cached devices render immediately, then spread their background boot
      // refresh over 15 seconds. A fleet-wide reload can no longer turn into
      // one synchronized request spike.
      const bootRefresh = new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 15001)))
        .then(() => {
          if (isStale()) {
            const error = new Error('Stale boot refresh');
            error.code = 'STALE_BOOT';
            throw error;
          }
          return LB.loadFromSupabase(uid);
        });
      foregroundRefresh.current = bootRefresh;
      lastForegroundRefreshAt.current = Date.now();
      bootRefresh
        .then(fresh => {
          if (isStale()) return;
          const cur = prevStore.current;
          // fresh is the pristine server state, use it as the sync diff base.
          // BUT sessions outside the history window come back with entries:[]
          // (their sets aren't loaded), while the cache-first merge below
          // restores their cached entries into the store. If the diff base kept
          // entries:[] for them, every boot would diff the restored entries as
          // "new" and re-upload all their sets stamped now(), clobbering newer
          // cross-device edits and growing write load with account age (audit
          // B1). Carry the last-synced entries (from the persisted base) into
          // the diff base so _syncEntryRelational's per-set diff sees them
          // unchanged and skips them; a genuine offline edit still differs and
          // is pushed. First boot / no base → entries:[] fallback (one re-sync,
          // then self-heals once the post-boot flush saves the merged base).
          const diffBase = { ...fresh, sessions: LB.withCarriedWindowEntries(fresh.sessions, base?.sessions) };
          syncBase.current = diffBase;
          let merged = fresh;
          // fresh.coaching is deliberately undefined when loadFromSupabase's
          // coaching queries failed (see its own comment: unlike every other
          // collection, that failure is isolated rather than aborting the
          // whole boot). undefined here specifically means "could not check
          // this time", never "no coaching relationship" (that's the object
          // shape with null/empty fields), so keep whatever was already
          // showing instead of blanking the coaching banner on a transient
          // error.
          if (merged.coaching === undefined && cur?.coaching !== undefined) merged.coaching = cur.coaching;
          if (cur) {
            // Same unsynced-edit test LB.mergeBootScalars applies below: an explicit
            // local null, "session just ended on this device", must still win
            // over the stale server value instead of being treated as missing
            // and resurrecting the old session, but ONLY if this device
            // actually changed it since the last confirmed-synced base.
            // Blindly trusting cur (the old `in`-operator check, true for
            // every cached store since inProgress is always a key) let a
            // SECOND device that never started a session, or whose cache
            // still held a stale local null, overwrite the server's pointer
            // to a session actively running on a FIRST device just by
            // opening the app. The next load then treated that still-open
            // session as an orphan and deleted it, cascading away real
            // logged sets. No base (legacy cache) → keep cur, matching every
            // other no-base fallback in this merge.
            const inProgressId = LB.resolveInProgressId(cur, fresh, base);
            // Session merge lives in store.js (LB.mergeSessions) so the
            // windowing rules are unit-tested: the "missing on the server →
            // drop" logic works on the (complete) metadata list, while cached
            // entries of sessions outside the boot window are preserved.
            // The persisted base tells apart "never reached the server" (keep
            // + re-sync) from "deleted on another device" (drop, keeping it
            // would push it right back).
            const { sessions, activeExists } = LB.mergeSessions(fresh.sessions, cur.sessions, inProgressId, base?.sessions);
            // Same resurrection guard for the other ID-merged collections:
            // local-only items are kept only if they were never confirmed
            // synced (not in the base). No base (legacy cache) → keep.
            const serverExIds = new Set(fresh.exercises.map(e => e.id));
            const baseExIds = base ? new Set((base.exercises || []).map(e => e.id)) : null;
            const localOnlyExercises = (cur.exercises || []).filter(x => !serverExIds.has(x.id) && !baseExIds?.has(x.id));
            const serverSchIds = new Set(fresh.schedules.map(s => s.id));
            const baseSchIds = base ? new Set((base.schedules || []).map(s => s.id)) : null;
            const localOnlySchedules = (cur.schedules || []).filter(x => !serverSchIds.has(x.id) && !baseSchIds?.has(x.id));
            const serverSkipIds = new Set((fresh.skips || []).map(s => s.id));
            const baseSkipIds = base ? new Set((base.skips || []).map(s => s.id)) : null;
            const localOnlySkips = (cur.skips || []).filter(x => !serverSkipIds.has(x.id) && !baseSkipIds?.has(x.id));
            const serverDailyIds = new Set((fresh.dailyLogs || []).map(l => l.id));
            const serverDailyDates = new Set((fresh.dailyLogs || []).map(l => l.date));
            const baseDailyIds = base ? new Set((base.dailyLogs || []).map(l => l.id)) : null;
            // Daily logs are one-per-date: also drop a local row whose date the
            // server already has (a divergent id from a pre-RPC multi-device
            // write) so it doesn't show as a duplicate for that day.
            const localOnlyDailyLogs = (cur.dailyLogs || []).filter(x => !serverDailyIds.has(x.id) && !baseDailyIds?.has(x.id) && !serverDailyDates.has(x.date));
            const serverCardioIds = new Set((fresh.cardioLogs || []).map(l => l.id));
            const baseCardioIds = base ? new Set((base.cardioLogs || []).map(l => l.id)) : null;
            const localOnlyCardioLogs = (cur.cardioLogs || []).filter(x => !serverCardioIds.has(x.id) && !baseCardioIds?.has(x.id));
            const serverWaterIds = new Set((fresh.waterLogs || []).map(l => l.id));
            const baseWaterIds = base ? new Set((base.waterLogs || []).map(l => l.id)) : null;
            const localOnlyWaterLogs = (cur.waterLogs || []).filter(x => !serverWaterIds.has(x.id) && !baseWaterIds?.has(x.id));
            const serverFoodIds = new Set((fresh.foodLogs || []).map(l => l.id));
            const baseFoodIds = base ? new Set((base.foodLogs || []).map(l => l.id)) : null;
            const localOnlyFoodLogs = (cur.foodLogs || []).filter(x => !serverFoodIds.has(x.id) && !baseFoodIds?.has(x.id));
            // Food Tracker quick-add (favorites/recipes, migration 0187): same
            // owned-list shape and guard as workoutTemplates below.
            const serverFavIds = new Set((fresh.foodFavorites || []).map(f => f.id));
            const baseFavIds = base ? new Set((base.foodFavorites || []).map(f => f.id)) : null;
            const localOnlyFavorites = (cur.foodFavorites || []).filter(x => !serverFavIds.has(x.id) && !baseFavIds?.has(x.id));
            const serverRecipeIds = new Set((fresh.foodRecipes || []).map(r => r.id));
            const baseRecipeIds = base ? new Set((base.foodRecipes || []).map(r => r.id)) : null;
            const localOnlyRecipes = (cur.foodRecipes || []).filter(x => !serverRecipeIds.has(x.id) && !baseRecipeIds?.has(x.id));
            const serverTemplateSlotIds = new Set((fresh.foodTemplateSlots || []).map(t => t.id));
            const baseTemplateSlotIds = base ? new Set((base.foodTemplateSlots || []).map(t => t.id)) : null;
            const localOnlyTemplateSlots = (cur.foodTemplateSlots || []).filter(x => !serverTemplateSlotIds.has(x.id) && !baseTemplateSlotIds?.has(x.id));
            const serverTemplateDayIds = new Set((fresh.foodTemplateDays || []).map(d => d.id));
            const baseTemplateDayIds = base ? new Set((base.foodTemplateDays || []).map(d => d.id)) : null;
            const localOnlyTemplateDays = (cur.foodTemplateDays || []).filter(x => !serverTemplateDayIds.has(x.id) && !baseTemplateDayIds?.has(x.id));
            const serverMealPlanIds = new Set((fresh.foodMealPlans || []).map(p => p.id));
            const baseMealPlanIds = base ? new Set((base.foodMealPlans || []).map(p => p.id)) : null;
            const localOnlyMealPlans = (cur.foodMealPlans || []).filter(x => !serverMealPlanIds.has(x.id) && !baseMealPlanIds?.has(x.id));
            // Templates and cardio plans need the same resurrection guard as
            // exercises/schedules, previously missing here entirely, so a
            // template saved (or a cardio plan created) offline before the
            // first sync completed was silently discarded on the next merge.
            const serverTplIds = new Set((fresh.workoutTemplates || []).map(t => t.id));
            const baseTplIds = base ? new Set((base.workoutTemplates || []).map(t => t.id)) : null;
            const localOnlyTemplates = (cur.workoutTemplates || []).filter(x => !serverTplIds.has(x.id) && !baseTplIds?.has(x.id));
            // Same guard for check-in schema templates (audit M1): without it a
            // template saved offline before the first sync completed was dropped
            // on the next boot merge, and a locally-deleted one was resurrected.
            const serverCheckinTplIds = new Set((fresh.checkinSchemaTemplates || []).map(t => t.id));
            const baseCheckinTplIds = base ? new Set((base.checkinSchemaTemplates || []).map(t => t.id)) : null;
            const localOnlyCheckinTemplates = (cur.checkinSchemaTemplates || []).filter(x => !serverCheckinTplIds.has(x.id) && !baseCheckinTplIds?.has(x.id));
            const serverCardioPlanIds = new Set((fresh.cardioPlans || []).map(p => p.id));
            const baseCardioPlanIds = base ? new Set((base.cardioPlans || []).map(p => p.id)) : null;
            const localOnlyCardioPlans = (cur.cardioPlans || []).filter(x => !serverCardioPlanIds.has(x.id) && !baseCardioPlanIds?.has(x.id));
            // Shopping List prefs (migration 0215) and the five Medications
            // tables (migration 0218/0221) need the exact same resurrection
            // guard as every collection above: without it, a package size set
            // or a dose logged in the seconds before this background fetch
            // resolves is silently discarded by the plain `...fresh` spread,
            // and since syncBase.current is also repointed to that same fresh
            // reference right after, the lost edit is never even re-uploaded.
            const serverShopPrefIds = new Set((fresh.foodShoppingPrefs || []).map(p => p.id));
            const baseShopPrefIds = base ? new Set((base.foodShoppingPrefs || []).map(p => p.id)) : null;
            const localOnlyShopPrefs = (cur.foodShoppingPrefs || []).filter(x => !serverShopPrefIds.has(x.id) && !baseShopPrefIds?.has(x.id));
            const serverMedPlanIds = new Set((fresh.medicationPlans || []).map(p => p.id));
            const baseMedPlanIds = base ? new Set((base.medicationPlans || []).map(p => p.id)) : null;
            const localOnlyMedPlans = (cur.medicationPlans || []).filter(x => !serverMedPlanIds.has(x.id) && !baseMedPlanIds?.has(x.id));
            const serverMedIds = new Set((fresh.medications || []).map(m => m.id));
            const baseMedIds = base ? new Set((base.medications || []).map(m => m.id)) : null;
            const localOnlyMeds = (cur.medications || []).filter(x => !serverMedIds.has(x.id) && !baseMedIds?.has(x.id));
            const serverMedSlotIds = new Set((fresh.medicationScheduleSlots || []).map(s => s.id));
            const baseMedSlotIds = base ? new Set((base.medicationScheduleSlots || []).map(s => s.id)) : null;
            const localOnlyMedSlots = (cur.medicationScheduleSlots || []).filter(x => !serverMedSlotIds.has(x.id) && !baseMedSlotIds?.has(x.id));
            const serverMedLogIds = new Set((fresh.medicationLogs || []).map(l => l.id));
            const baseMedLogIds = base ? new Set((base.medicationLogs || []).map(l => l.id)) : null;
            const localOnlyMedLogs = (cur.medicationLogs || []).filter(x => !serverMedLogIds.has(x.id) && !baseMedLogIds?.has(x.id));
            const serverMedPlanItemIds = new Set((fresh.medicationPlanItems || []).map(i => i.id));
            const baseMedPlanItemIds = base ? new Set((base.medicationPlanItems || []).map(i => i.id)) : null;
            const localOnlyMedPlanItems = (cur.medicationPlanItems || []).filter(x => !serverMedPlanItemIds.has(x.id) && !baseMedPlanItemIds?.has(x.id));
            const serverMedPillboxCheckIds = new Set((fresh.medicationPillboxChecks || []).map(c => c.id));
            const baseMedPillboxCheckIds = base ? new Set((base.medicationPillboxChecks || []).map(c => c.id)) : null;
            const localOnlyMedPillboxChecks = (cur.medicationPillboxChecks || []).filter(x => !serverMedPillboxCheckIds.has(x.id) && !baseMedPillboxCheckIds?.has(x.id));
            // Locally-deleted items (in base but not in cur): exclude from fresh
            // so they aren't resurrected while syncStore deletion is in flight.
            const curExIdSet = new Set((cur.exercises || []).map(e => e.id));
            const delExIds = baseExIds ? new Set([...baseExIds].filter(id => !curExIdSet.has(id))) : null;
            const curSchIdSet = new Set((cur.schedules || []).map(s => s.id));
            const delSchIds = baseSchIds ? new Set([...baseSchIds].filter(id => !curSchIdSet.has(id))) : null;
            const curSkipIdSet = new Set((cur.skips || []).map(s => s.id));
            const delSkipIds = baseSkipIds ? new Set([...baseSkipIds].filter(id => !curSkipIdSet.has(id))) : null;
            const curDailyIdSet = new Set((cur.dailyLogs || []).map(l => l.id));
            const delDailyIds = baseDailyIds ? new Set([...baseDailyIds].filter(id => !curDailyIdSet.has(id))) : null;
            const curCardioIdSet = new Set((cur.cardioLogs || []).map(l => l.id));
            const delCardioIds = baseCardioIds ? new Set([...baseCardioIds].filter(id => !curCardioIdSet.has(id))) : null;
            const curWaterIdSet = new Set((cur.waterLogs || []).map(l => l.id));
            const delWaterIds = baseWaterIds ? new Set([...baseWaterIds].filter(id => !curWaterIdSet.has(id))) : null;
            const curFoodIdSet = new Set((cur.foodLogs || []).map(l => l.id));
            const delFoodIds = baseFoodIds ? new Set([...baseFoodIds].filter(id => !curFoodIdSet.has(id))) : null;
            const curFavIdSet = new Set((cur.foodFavorites || []).map(f => f.id));
            const delFavIds = baseFavIds ? new Set([...baseFavIds].filter(id => !curFavIdSet.has(id))) : null;
            const curRecipeIdSet = new Set((cur.foodRecipes || []).map(r => r.id));
            const delRecipeIds = baseRecipeIds ? new Set([...baseRecipeIds].filter(id => !curRecipeIdSet.has(id))) : null;
            const curTemplateSlotIdSet = new Set((cur.foodTemplateSlots || []).map(t => t.id));
            const delTemplateSlotIds = baseTemplateSlotIds ? new Set([...baseTemplateSlotIds].filter(id => !curTemplateSlotIdSet.has(id))) : null;
            const curTemplateDayIdSet = new Set((cur.foodTemplateDays || []).map(d => d.id));
            const delTemplateDayIds = baseTemplateDayIds ? new Set([...baseTemplateDayIds].filter(id => !curTemplateDayIdSet.has(id))) : null;
            const curMealPlanIdSet = new Set((cur.foodMealPlans || []).map(p => p.id));
            const delMealPlanIds = baseMealPlanIds ? new Set([...baseMealPlanIds].filter(id => !curMealPlanIdSet.has(id))) : null;
            const curTplIdSet = new Set((cur.workoutTemplates || []).map(t => t.id));
            const delTplIds = baseTplIds ? new Set([...baseTplIds].filter(id => !curTplIdSet.has(id))) : null;
            const curCheckinTplIdSet = new Set((cur.checkinSchemaTemplates || []).map(t => t.id));
            const delCheckinTplIds = baseCheckinTplIds ? new Set([...baseCheckinTplIds].filter(id => !curCheckinTplIdSet.has(id))) : null;
            const curCardioPlanIdSet = new Set((cur.cardioPlans || []).map(p => p.id));
            const delCardioPlanIds = baseCardioPlanIds ? new Set([...baseCardioPlanIds].filter(id => !curCardioPlanIdSet.has(id))) : null;
            const curShopPrefIdSet = new Set((cur.foodShoppingPrefs || []).map(p => p.id));
            const delShopPrefIds = baseShopPrefIds ? new Set([...baseShopPrefIds].filter(id => !curShopPrefIdSet.has(id))) : null;
            const curMedPlanIdSet = new Set((cur.medicationPlans || []).map(p => p.id));
            const delMedPlanIds = baseMedPlanIds ? new Set([...baseMedPlanIds].filter(id => !curMedPlanIdSet.has(id))) : null;
            const curMedIdSet = new Set((cur.medications || []).map(m => m.id));
            const delMedIds = baseMedIds ? new Set([...baseMedIds].filter(id => !curMedIdSet.has(id))) : null;
            const curMedSlotIdSet = new Set((cur.medicationScheduleSlots || []).map(s => s.id));
            const delMedSlotIds = baseMedSlotIds ? new Set([...baseMedSlotIds].filter(id => !curMedSlotIdSet.has(id))) : null;
            const curMedLogIdSet = new Set((cur.medicationLogs || []).map(l => l.id));
            const delMedLogIds = baseMedLogIds ? new Set([...baseMedLogIds].filter(id => !curMedLogIdSet.has(id))) : null;
            const curMedPlanItemIdSet = new Set((cur.medicationPlanItems || []).map(i => i.id));
            const delMedPlanItemIds = baseMedPlanItemIds ? new Set([...baseMedPlanItemIds].filter(id => !curMedPlanItemIdSet.has(id))) : null;
            const curMedPillboxCheckIdSet = new Set((cur.medicationPillboxChecks || []).map(c => c.id));
            const delMedPillboxCheckIds = baseMedPillboxCheckIds ? new Set([...baseMedPillboxCheckIds].filter(id => !curMedPillboxCheckIdSet.has(id))) : null;
            // Meso states are a mutable per-plan row (not an append/delete list),
            // so for ids present on both sides we compare updatedAt and keep
            // whichever is newer, this protects an in-flight local session's
            // not-yet-synced feedback deltas from being clobbered by a boot
            // refresh that raced ahead. Ids present on only one side still
            // need the same base-membership resurrection guard as every
            // sibling collection: a row the user deleted locally (e.g. turned
            // mesocycle off for a plan) whose deletion hasn't synced yet must
            // not be resurrected from the stale server copy.
            const freshMesoMap = new Map((fresh.mesoStates || []).map(m => [m.id, m]));
            const curMesoMap = new Map((cur.mesoStates || []).map(m => [m.id, m]));
            const baseMesoIds = base ? new Set((base.mesoStates || []).map(m => m.id)) : null;
            const mesoStates = [...new Set([...freshMesoMap.keys(), ...curMesoMap.keys()])].map(id => {
              const f = freshMesoMap.get(id);
              const c = curMesoMap.get(id);
              if (!f) return baseMesoIds?.has(id) ? null : c; // local-only: keep only if never confirmed synced
              if (!c) return baseMesoIds?.has(id) ? null : f; // server-only: resurrect only if genuinely new elsewhere
              const fT = f.updatedAt ? new Date(f.updatedAt).getTime() : 0;
              const cT = c.updatedAt ? new Date(c.updatedAt).getTime() : 0;
              return cT >= fT ? c : f;
            }).filter(Boolean);
            // For ids present on BOTH sides, keep the server row unless the
            // local row carries an unsynced offline edit, i.e. the id is in
            // the persisted base AND local differs from base. Without this a
            // row edited offline would be reverted to the server value and then
            // re-synced back as the old value. Conservative: no base membership
            // or local == base → server wins (mirrors the mesoStates merge).
            const mergeById = LB.mergeCollectionById;
            // Plan-editor drafts: their own last-write-wins map merge, fully
            // isolated from the schedule merge so an autosaved draft can never
            // touch a committed plan (and a schedule merge quirk can't drop it).
            const planDrafts = LB.mergePlanDrafts(fresh.planDrafts, cur.planDrafts, base?.planDrafts);
            // Status periods first: LB.mergeBootScalars needs the merged rows to
            // settle statusMode against, since an open period is written
            // straight to the server while the mode itself rides the diff queue.
            // Server membership decides which periods exist (they are only ever
            // created by a direct write), the local side wins on a field that
            // diverged from base, same rule as every other id-keyed collection.
            const statusPeriods = mergeById(fresh.statusPeriods || [], cur.statusPeriods, base?.statusPeriods);
            // Every top-level scalar, grouped so coupled pointers resolve as one
            // unit. Lives in store.js because it is the one part of this merge
            // that can be unit-tested, and the boot merge is where the expensive
            // mistakes have historically been made.
            const bootScalars = LB.mergeBootScalars(fresh, cur, base, statusPeriods);
            // Scalar state: the local cache is authoritative, it always holds
            // the most recent state on this device, including unsynced offline
            // edits. For items with IDs we use an ID-based merge instead.
            // Water tracker config is an exception: it must propagate across
            // devices (set a goal on the phone, see it on the desktop). Same
            // base-aware rule as the plan-position fields above: keep this
            // device's value only when it changed it since base (an unsynced
            // local edit), otherwise take the server's. No base (legacy cache)
            // -> keep cur, matching the plan-position fields' own fallback and
            // every other no-base fallback in this merge (fixed: this used to
            // read `base && (...)`, which is falsy when base is null/undefined
            // and so took the server value on a no-base boot instead of cur,
            // the opposite of the intended rule). Bottle counters are included
            // too: confirming "Bottle empty?" on one device must reset the
            // progress ring and show the emptied bottle under "Other drinks
            // today" on every device, the same as any other water stat.
            // This used to be the other way round: the local cache won for
            // every key except the water ones, even though the diff base was
            // just set to the pristine server state. The post-boot flush then
            // read the stale local value as a local change and upserted it
            // over the fresher server one, so macro targets, meal windows,
            // hidden health cards, rest defaults, planMode or a coach-pushed
            // meal plan set on one device were silently reverted by the next
            // boot of another device. The base-aware rule the water keys and
            // the plan-position tuple already used is the right default for
            // ALL settings: keep this device's value only if this device
            // actually changed it since the last confirmed sync.
            //
            // Device-scoped settings are the exception: they describe THIS
            // device, are mirrored in localStorage, and must never be taken
            // from whatever device synced last.
            const DEVICE_ONLY_SETTINGS = ['darkMode', 'accentColor', 'swVersion', 'cycleWeekView', 'pushEnabled'];
            const mergedSettings = { ...fresh.settings, ...cur.settings };
            const settingKeys = new Set([...Object.keys(fresh.settings || {}), ...Object.keys(cur.settings || {})]);
            for (const k of settingKeys) {
              if (DEVICE_ONLY_SETTINGS.includes(k)) continue;
              const localUnsynced = !base || JSON.stringify(cur.settings?.[k]) !== JSON.stringify(base.settings?.[k]);
              if (!localUnsynced) mergedSettings[k] = fresh.settings?.[k];
            }
            // No base (legacy cache) means the rule above cannot tell a local
            // edit from a stale value, so keep the old special case: a
            // server-side unit of null (admin reset / never chosen) wins, and
            // the unit picker re-fires.
            if (!base && fresh.settings.unit == null) mergedSettings.unit = null;
            merged = {
              ...fresh,
              // This admin-only counter is deliberately omitted from the
              // server payload and local snapshots. Preserve the live value
              // while replacing the rest of the boot state.
              adminSupportUnread: adminSupportUnreadRef.current ?? cur?.adminSupportUnread ?? 0,
              // Local cache is authoritative for scalar settings (preserves
              // offline edits), except a server-side unit of null (admin reset
              // / not chosen) must win so the picker re-fires, since the cache
              // still holds the old kg/lbs value; and the water config above.
              settings: mergedSettings,
              ...bootScalars,
              statusPeriods,
              user: mergeProfileIdentity(fresh.user, cur, base),
              inProgress: activeExists ? inProgressId : null,
              sessions,
              exercises: [...localOnlyExercises, ...mergeById(fresh.exercises, cur.exercises, base?.exercises, delExIds)],
              schedules: [...localOnlySchedules, ...mergeById(fresh.schedules, cur.schedules, base?.schedules, delSchIds)],
              skips: [...localOnlySkips, ...(fresh.skips || []).filter(s => !delSkipIds?.has(s.id))],
              dailyLogs: [...localOnlyDailyLogs, ...mergeById(fresh.dailyLogs, cur.dailyLogs, base?.dailyLogs, delDailyIds)],
              cardioLogs: [...localOnlyCardioLogs, ...mergeById(fresh.cardioLogs, cur.cardioLogs, base?.cardioLogs, delCardioIds)],
              waterLogs: [...localOnlyWaterLogs, ...mergeById(fresh.waterLogs, cur.waterLogs, base?.waterLogs, delWaterIds)],
              foodLogs: [...localOnlyFoodLogs, ...mergeById(fresh.foodLogs, cur.foodLogs, base?.foodLogs, delFoodIds)],
              foodFavorites: [...localOnlyFavorites, ...mergeById(fresh.foodFavorites, cur.foodFavorites, base?.foodFavorites, delFavIds)],
              foodRecipes: [...localOnlyRecipes, ...mergeById(fresh.foodRecipes, cur.foodRecipes, base?.foodRecipes, delRecipeIds)],
              foodTemplateSlots: [...localOnlyTemplateSlots, ...mergeById(fresh.foodTemplateSlots, cur.foodTemplateSlots, base?.foodTemplateSlots, delTemplateSlotIds)],
              foodTemplateDays: [...localOnlyTemplateDays, ...mergeById(fresh.foodTemplateDays, cur.foodTemplateDays, base?.foodTemplateDays, delTemplateDayIds)],
              foodMealPlans: [...localOnlyMealPlans, ...mergeById(fresh.foodMealPlans, cur.foodMealPlans, base?.foodMealPlans, delMealPlanIds)],
              // mergeById, not a bare server-wins filter: for an id present on
              // both sides these three used to take the server row outright,
              // so an offline rename or edit of an EXISTING template or cardio
              // plan was dropped by the background load and never re-pushed
              // (the diff base is the server state by then). Every sibling
              // collection above already goes through mergeById for exactly
              // this reason.
              workoutTemplates: [...localOnlyTemplates, ...mergeById(fresh.workoutTemplates || [], cur.workoutTemplates, base?.workoutTemplates, delTplIds)],
              checkinSchemaTemplates: [...localOnlyCheckinTemplates, ...mergeById(fresh.checkinSchemaTemplates || [], cur.checkinSchemaTemplates, base?.checkinSchemaTemplates, delCheckinTplIds)],
              cardioPlans: [...localOnlyCardioPlans, ...mergeById(fresh.cardioPlans || [], cur.cardioPlans, base?.cardioPlans, delCardioPlanIds)],
              foodShoppingPrefs: [...localOnlyShopPrefs, ...mergeById(fresh.foodShoppingPrefs || [], cur.foodShoppingPrefs, base?.foodShoppingPrefs, delShopPrefIds)],
              medicationPlans: [...localOnlyMedPlans, ...mergeById(fresh.medicationPlans || [], cur.medicationPlans, base?.medicationPlans, delMedPlanIds)],
              medications: [...localOnlyMeds, ...mergeById(fresh.medications || [], cur.medications, base?.medications, delMedIds)],
              medicationScheduleSlots: [...localOnlyMedSlots, ...mergeById(fresh.medicationScheduleSlots || [], cur.medicationScheduleSlots, base?.medicationScheduleSlots, delMedSlotIds)],
              medicationLogs: [...localOnlyMedLogs, ...mergeById(fresh.medicationLogs || [], cur.medicationLogs, base?.medicationLogs, delMedLogIds)],
              medicationPlanItems: [...localOnlyMedPlanItems, ...mergeById(fresh.medicationPlanItems || [], cur.medicationPlanItems, base?.medicationPlanItems, delMedPlanItemIds)],
              medicationPillboxChecks: [...localOnlyMedPillboxChecks, ...mergeById(fresh.medicationPillboxChecks || [], cur.medicationPillboxChecks, base?.medicationPillboxChecks, delMedPillboxCheckIds)],
              mesoStates,
              planDrafts,
              // TDEE history is loaded by HealthScreen separately because it
              // can be reconstructed from the health logs. The regular boot
              // payload does not carry it, so never let this background merge
              // erase rows that arrived through that dedicated loader.
              adaptiveTdeeHistory: LB.mergeAdaptiveTdeeHistory(fresh.adaptiveTdeeHistory || [], cur.adaptiveTdeeHistory || []),
            };
          }
          prevStore.current = merged;
          setStore(merged);
          refreshAdminSupportUnread();
        })
        .catch(err => { if (!isStale()) console.error(err); })
        .finally(() => {
          if (foregroundRefresh.current === bootRefresh) foregroundRefresh.current = null;
        });
    } else {
      setPhase('loading');
      let essentialBase = null;
      stagedBootHydrating.current = true;
      try {
        const bootRefresh = LB.loadFromSupabase(uid, 0, {
          onEssential: essential => {
            if (isStale() || recoveryInProgress.current) return;
            essentialBase = essential;
            prevStore.current = essential;
            syncBase.current = essential;
            pendingStore.current = essential;
            setStore(essential);
            setPhase('ready');
          },
        });
        foregroundRefresh.current = bootRefresh;
        lastForegroundRefreshAt.current = Date.now();
        const loaded = await bootRefresh.finally(() => {
          if (foregroundRefresh.current === bootRefresh) foregroundRefresh.current = null;
        });
        // Same guard as the cached path: this await can outlive the account.
        if (isStale()) { stagedBootHydrating.current = false; return; }
        // PASSWORD_RECOVERY event may have fired while we were fetching, don't override the reset screen
        if (recoveryInProgress.current) { stagedBootHydrating.current = false; return; }
        const hydrated = essentialBase
          ? mergeStagedBootStore(loaded, pendingStore.current || prevStore.current || essentialBase, essentialBase)
          : loaded;
        stagedBootHydrating.current = false;
        prevStore.current = hydrated;
        syncBase.current = loaded;
        pendingStore.current = hydrated;
        setStore(hydrated);
        setPhase('ready');
        refreshAdminSupportUnread();
      } catch (e) {
        if (isStale()) { stagedBootHydrating.current = false; return; }
        stagedBootHydrating.current = false;
        console.error('loadFromSupabase failed', e);
        // Essential data is already usable. A secondary table can retry on
        // the next foreground without replacing a working first screen with
        // the global error view.
        if (!essentialBase) setPhase('error');
      }
    }
  };

  useEffectA(() => {
    const { data: { subscription } } = LB.supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        if (session) {
          setUserId(session.user.id);
          if (isTokenFlow.current) { isTokenFlow.current = false; setPhase('invite'); }
          else loadData(session.user.id);
        }
        // Offline with no restorable session: show the error screen, not the
        // login screen, you can't sign in offline, and a retry recovers.
        else          { setPhase(navigator.onLine ? 'unauthed' : 'error'); }
      } else if (event === 'SIGNED_IN') {
        // Re-arm the onboarding check for the freshly signed-in user. The ref is
        // a one-shot guard that survives in-session account switches (logout →
        // login without a page reload), so without this a newly registered user
        // logging in after a previous 'ready' session would never be prompted.
        onboardingChecked.current = false;
        unitPicked.current = false; // re-arm unit watcher for the new account
        recoveryInProgress.current = false; // clear so loadData can complete after a password reset
        intentionalSignOut.current = null;  // a sign-out that never completed must not arm the next one
        // Cancel any pending retry from the previous account so it can't fire
        // with the old uid after an in-session account switch, and drop its
        // stale pending state.
        clearTimeout(retryTimer.current);
        pendingStore.current = null;
        setUserId(session.user.id);
        if (isTokenFlow.current) { isTokenFlow.current = false; setPhase('invite'); }
        else loadData(session.user.id);
      } else if (event === 'PASSWORD_RECOVERY') {
        // Supabase fires this (in addition to or instead of SIGNED_IN) when a
        // recovery link is clicked, handle it explicitly so the reset screen
        // always appears regardless of whether the implicit-flow hash is present.
        recoveryInProgress.current = true;
        isRecoveryFlow.current = true;
        setUserId(session.user.id);
        setPhase('invite');
      } else if (event === 'SIGNED_OUT') {
        onboardingChecked.current = false;
        unitPicked.current = false;
        recoveryInProgress.current = false;
        // Only a deliberate LB.signOut() (Settings → Sign out / Delete all
        // data / pending-approval sign-out, each of which calls
        // markIntentionalSignOut() first) may wipe the local pending diff.
        // Any other SIGNED_OUT, offline, a flaky refresh, a revoked or
        // expired session, is involuntary: wiping here would delete
        // unsynced edits with no way to retry them once the next login pulls
        // a clean server state back down. (Confirmed: a workout logged
        // during a broken refresh cycle was lost exactly this way when the
        // user was told to just log back in.)
        // The latch is a TIMESTAMP, not a flag: if the LB.signOut() it was
        // armed for never produced a SIGNED_OUT (GoTrue 5xx, dead network),
        // a plain boolean stayed true for the rest of the page session and
        // handed the wipe to the next involuntary sign-out instead.
        const armedAt = intentionalSignOut.current;
        const armed = !!armedAt && (Date.now() - armedAt) < INTENTIONAL_SIGNOUT_TTL_MS;
        intentionalSignOut.current = null;
        if (!armed) { setPhase(p => (p === 'ready' ? p : 'error')); return; }
        LB.clearLocal(userIdRef.current);
        clearTimeout(retryTimer.current);
        setStore(null);
        setUserId(null);
        prevStore.current = null;
        syncBase.current = null;
        pendingStore.current = null;
        syncing.current = false;
        // Invalidate any in-flight loadData: its result belongs to the account
        // that just went away and must never merge into the next one.
        loadSeq.current++;
        setRoute({ name: 'home' });
        setPhase('unauthed');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Auto-close notification, fully decoupled from the login/load path. It runs
  // only once the app is already 'ready', as an isolated query OUTSIDE the
  // onAuthStateChange flow, so it never contends for the auth lock and can never
  // block or fail login. If the query fails or hangs, login is unaffected.
  useEffectA(() => {
    if (phase !== 'ready' || !userId) return;
    let cancelled = false;
    LB.supabase.from('zane_user_settings').select('auto_close_notify').eq('user_id', userId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const n = data?.auto_close_notify;
        if (n) {
          setAutoCloseNotify(n);
          // Fire-and-forget clear. The PostgREST builder is a thenable that only
          // implements `then`, `.catch()` doesn't reliably trigger the request,
          // so use `.then(resolve, reject)` (the codebase pattern) to actually
          // send the UPDATE. Without this the notification is never cleared and
          // re-appears on every load.
          LB.supabase.from('zane_user_settings').update({ auto_close_notify: null }).eq('user_id', userId).then(() => {}, () => {});
        }
      })
      .then(undefined, () => {});
    return () => { cancelled = true; };
  }, [phase, userId]);

  // What's New, the first time the app is 'ready' after an update, show every
  // changelog entry the user hasn't seen yet (bundled into one card), so anyone
  // returning after several releases catches up on all of them at once.
  // whatsnew.js is a lazy load now (index.html's __ensureWhatsNew, moved out
  // of the blocking boot script list, ~116KB of changelog text most boots
  // never need): fetch it here instead of trusting window.WHATS_NEW to
  // already be populated. Skips the fetch entirely when this boot is about
  // to show the onboarding welcome prompt instead (below): that effect calls
  // setWhatsNew(null) synchronously the moment it decides, but this effect's
  // own fetch resolves later (async), so without this guard a brand-new
  // user could see What's New flash back on top of onboarding once the
  // fetch lands. Reads storeRefA rather than adding store as a dependency,
  // same reasoning as before: this only ever needs to run once per
  // ready-transition, not on every store update.
  useEffectA(() => {
    if (phase !== 'ready') {
      setWhatsNewSettled(false);
      return;
    }
    const s = storeRefA.current;
    if (s && !onboardingChecked.current && onboardingOwnsBoot(s)) {
      setWhatsNewSettled(true);
      return;
    }
    setWhatsNewSettled(false);
    let live = true;
    const settled = () => { if (live) setWhatsNewSettled(true); };
    window.__ensureWhatsNew().then(() => {
      if (!live) return;
      // Re-check after the await, not only before it: the onboarding effect
      // can reach its decision while the script is still loading (it waits on
      // the unit picker, which the user answers in exactly that window), and
      // its synchronous setWhatsNew(null) would otherwise be overwritten right
      // here, leaving a What's New card mounted behind the onboarding overlay
      // that surfaces the moment onboarding is dismissed.
      if (onboardingOwnsBoot(storeRefA.current)) { settled(); return; }
      const unseen = unseenWhatsNew();
      if (unseen.length) setWhatsNew(unseen);
      settled();
    }, settled); // best-effort: a failed lazy fetch just means no What's New this session
    return () => { live = false; };
  }, [phase]);

  const dismissWhatsNew = useCallbackA(() => {
    // Mark everything up to the newest entry as seen.
    const newest = (window.WHATS_NEW || [])[0];
    try { if (newest?.id) localStorage.setItem(WHATS_NEW_KEY, newest.id); } catch (_) {}
    setWhatsNew(null);
  }, []);

  // Onboarding: show welcome prompt to new users (no completed sessions).
  // Users who already trained get the flag set silently. While the unit is
  // still unchosen (null) we defer, the unit picker (separate effect below)
  // takes precedence so the two don't stack, and re-fire once it's set.
  useEffectA(() => {
    if (phase !== 'ready' || !store || onboardingChecked.current) return;
    if (store.settings?.unit == null) return; // wait until unit chosen; don't mark checked
    onboardingChecked.current = true;
    if ((store.sessions || []).some(s => s.ended)) {
      if (!store.settings?.onboardingCompleted) {
        setStore(s => s ? { ...s, settings: { ...s.settings, onboardingCompleted: true } } : s);
      }
      return;
    }
    if (!store.settings?.onboardingCompleted) {
      // Pre-dismiss What's New so it doesn't stack with the welcome prompt.
      // window.WHATS_NEW may not be loaded yet (lazy load, see the effect
      // above, whose own guard skips its fetch specifically to defer to this
      // decision): fetch it here so the seen-stamp still lands, but don't
      // await it before clearing/prompting below, both fire synchronously
      // exactly as before, only the stamp write is now async.
      window.__ensureWhatsNew().then(() => {
        try {
          const newest = (window.WHATS_NEW || [])[0];
          if (newest?.id && !localStorage.getItem(WHATS_NEW_KEY)) {
            localStorage.setItem(WHATS_NEW_KEY, newest.id);
          }
        } catch (_) {}
      }).catch(() => {});
      setWhatsNew(null);
      setOnboardingState({ phase: 'prompt' });
    }
  }, [phase, store]);

  // Unit picker: opens whenever the stored unit is null, a fresh user, or a
  // user an admin reset (kg → null) to re-ask. Ungated by onboardingChecked so
  // a reset re-prompts even long-onboarded users. Setting the unit closes it.
  useEffectA(() => {
    if (phase === 'ready' && store && store.settings?.unit == null) setUnitPromptOpen(true);
  }, [phase, store?.settings?.unit]);

  // X handle prompt: evaluate only once per signed-in user per boot. A fresh
  // account deliberately gets no prompt in this boot: the Unit Picker and
  // onboarding own the first-run flow, and the handle prompt starts on the
  // next normal app start instead. Returning users become pending here and
  // wait for What's New and every higher-priority overlay to clear below.
  useEffectA(() => {
    if (phase !== 'ready' || !store || !userId) return;
    if (xHandlePromptCheckedUser.current === userId) return;
    xHandlePromptCheckedUser.current = userId;
    if (store.settings?.unit == null || !store.settings?.onboardingCompleted || onboardingOwnsBoot(store)) return;
    if (store.user?.xHandle || store.user?.xHandlePromptOptedOut) return;
    setXHandlePromptPending(true);
  }, [phase, userId, store?.settings?.unit, store?.settings?.onboardingCompleted, store?.user?.xHandle, store?.user?.xHandlePromptOptedOut]);

  // Do not stack the prompt over What's New, an update, a share link, a sheet,
  // a keyboard, or an in-progress session. The pending flag survives all of
  // those surfaces and opens as soon as the user is back on a quiet Home tab.
  useEffectA(() => {
    if (!xHandlePromptPending || phase !== 'ready' || !store || route.name !== 'home') return;
    if (!whatsNewSettled || whatsNew || onboardingState || unitPromptOpen || pendingShare ||
        autoCloseNotify || forceShowUpdateBanner || updateAvailable || openSheetCount > 0 ||
        textEntryFocused || store.inProgress) return;
    setXHandlePromptPending(false);
    setXHandlePromptOpen(true);
  }, [xHandlePromptPending, phase, store, route.name, whatsNewSettled, whatsNew, onboardingState, unitPromptOpen, pendingShare, autoCloseNotify, forceShowUpdateBanner, updateAvailable, openSheetCount, textEntryFocused]);

  // Sign-out/account switches must not carry a modal or a once-per-boot latch
  // into the next identity.
  useEffectA(() => {
    if (phase !== 'ready') {
      xHandlePromptCheckedUser.current = null;
      setXHandlePromptPending(false);
      setXHandlePromptOpen(false);
    }
  }, [phase]);

  // Detect an admin-side unit reset on a session that's already open. The
  // cache-first merge keeps the locally cached unit, so a server-side flip to
  // null wouldn't surface on its own. Re-fetch the unit on foreground (like the
  // SW-update check) and clear it locally when the server says null, the
  // picker effect above then fires. Stops polling once the unit is null.
  useEffectA(() => {
    if (phase !== 'ready' || !userId || store?.settings?.unit == null || unitPicked.current) return;
    const recheck = () => {
      // Don't fight a just-made local choice: the server is briefly still null
      // until the pick syncs, which would otherwise reset us and re-open the
      // picker in a loop. unitPicked latches that the user has decided.
      if (document.visibilityState !== 'visible' || unitPicked.current) return;
      LB.supabase.from('zane_user_settings').select('unit').eq('user_id', userId).maybeSingle()
        .then(({ data, error }) => {
          if (error || !data || data.unit != null || unitPicked.current) return;
          setStore(s => (s && s.settings?.unit != null) ? { ...s, settings: { ...s.settings, unit: null } } : s);
        })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', recheck);
    recheck();
    return () => document.removeEventListener('visibilitychange', recheck);
  }, [phase, userId, store?.settings?.unit]);



  // was removed, the local store is the single source of truth for a session.)
  //
  // activeCoachClients feeds the two coach-status realtime listeners below
  // (client training-status / check-in pushes) added to the same channel.
  // Keyed separately as coachClientsKey (stable string of coachingId:clientId
  // pairs) so the effect only tears down and re-subscribes when the actual
  // set of active clients changes (invite accepted/ended), not on every
  // store update: reloadCoachingState always returns a fresh asCoach array
  // reference even when its contents are unchanged.
  // Excludes support_-prefixed pseudo-coaching entries (admin support tickets,
  // status forced 'active' forever, see store.js's isNoteFromClient/
  // unreadCoachingNotes for the same established filter): without this the
  // admin account's list grows roughly one entry per registered user with an
  // open ticket, churning coachClientsKey (and the whole channel resubscribe)
  // on every unrelated support chat, and realistically risking the 100-id
  // in.() filter cap this isn't meant to hit.
  const activeCoachClients = React.useMemo(() => (
    (store?.coaching?.asCoach || [])
      .filter(c => c.status === 'active' && c.clientId && c.id && !c.id.startsWith('support_'))
      .map(c => ({ clientId: c.clientId, coachingId: c.id }))
  ), [store?.coaching?.asCoach]);
  const coachClientsKey = activeCoachClients.map(c => `${c.coachingId}:${c.clientId}`).sort().join(',');
  // Set by the isCoachActive poll effect below to whatever its current
  // `poll` closure is; read here (lazily, at event time) so the realtime
  // listener can trigger a re-poll without a second status-aggregation path.
  const pollFnRef = useRefA(null);
  useEffectA(() => {
    if (!userId) return;
    // A burst of realtime events (several clients finishing sets around the
    // same time, or one client's settings row updating repeatedly) should
    // still only trigger one re-poll, not one per event.
    let debounceTimer = null;
    const triggerPoll = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { pollFnRef.current?.(); }, 400);
    };
    const unsubscribe = LB.subscribeToChanges(
      userId,
      (note) => {
        setStore(s => {
          if (!s) return s;
          if (note.coachingId?.startsWith('support_')) {
            // Own support ticket reply → update badge and ticket list
            const myTicket = (s.supportTickets || []).some(t => t.coachingId === note.coachingId);
            if (myTicket) {
              return {
                ...s,
                supportUnread: (s.supportUnread || 0) + 1,
                supportTickets: (s.supportTickets || []).map(t =>
                  t.coachingId === note.coachingId
                    ? { ...t, unreadCount: t.unreadCount + 1, lastMessageAt: note.createdAt, lastMessageBody: note.body }
                    : t
                ),
              };
            }
            // Admin inbox: increment admin unread counter
            adminSupportUnreadRevision.current += 1;
            const nextUnread = (s.adminSupportUnread || 0) + 1;
            adminSupportUnreadRef.current = nextUnread;
            return { ...s, adminSupportUnread: nextUnread };
          }
          if (!s.coaching) return s;
          if ((s.coaching.unreadNotes || []).some(n => n.id === note.id)) return s;
          return {
            ...s,
            coaching: { ...s.coaching, unreadNotes: [note, ...(s.coaching.unreadNotes || [])] },
          };
        });
      },
      (eventType, coachingId, newRow) => {
        if (coachingId?.startsWith('support_')) {
          // A newly-created ticket can arrive before its first note, and a
          // reconnect can miss the note event entirely. Reconcile the durable
          // server count for all support-row changes; note events still win
          // over an older in-flight RPC through the revision guard above.
          adminSupportUnreadRevision.current += 1;
          refreshAdminSupportUnread();
        }
        if (eventType === 'DELETE' && coachingId?.startsWith('support_')) {
          setStore(s => s ? {
            ...s,
            supportTickets: (s.supportTickets || []).filter(t => t.coachingId !== coachingId),
            supportUnread: Math.max(0, (s.supportUnread || 0) - ((s.supportTickets || []).find(t => t.coachingId === coachingId)?.unreadCount || 0)),
          } : s);
          return;
        }
        if (eventType === 'UPDATE' && coachingId?.startsWith('support_') && newRow?.support_status) {
          setStore(s => s ? {
            ...s,
            supportTickets: (s.supportTickets || []).map(t =>
              t.coachingId === coachingId ? { ...t, status: newRow.support_status } : t
            ),
          } : s);
          return;
        }
        LB.reloadCoachingState(userId).then(coaching => {
          // reloadCoachingState rebuilds the relationship data only. Two
          // fields on store.coaching come from the 60s status poll instead
          // (anyClientLive, pendingCheckinsCount), and that poll skips its own
          // setStore while the values look unchanged, so replacing the object
          // wholesale dropped the live dot and the check-in badge until the
          // next real change.
          setStore(s => s ? { ...s, coaching: {
            ...coaching,
            anyClientLive: s.coaching?.anyClientLive,
            pendingCheckinsCount: s.coaching?.pendingCheckinsCount,
          } } : s);
        }).catch(() => {});
      },
      activeCoachClients,
      triggerPoll,
    );
    return () => { clearTimeout(debounceTimer); unsubscribe(); };
  }, [userId, coachClientsKey]);

  // Social data is deliberately feature-gated. A user who has not enabled the
  // Friends tab should not trigger any social RPC, table query, realtime
  // channel, or local-store hydration. Toggling it on while the app is alive
  // starts the same load path without requiring a remount.
  const friendsTabEnabled = phase === 'ready' && !!store?.settings?.showFriendsTab;
  const friendsDataEnabled = friendsTabEnabled && runtimeConfig.socialMode === 'normal';
  useEffectA(() => {
    if (!friendsDataEnabled || !userId) {
      if (storeRefA.current?.friends) setStore(s => s ? { ...s, friends: null } : s);
      return;
    }
    let live = true;
    let refreshTimer = null;
    let feedTimer = null;
    let badgeTimer = null;
    let socialRefreshInFlight = null;
    let socialRefreshQueued = false;
    let feedRefreshInFlight = null;
    let feedRefreshQueued = false;
    let messageRefreshInFlight = null;
    let messageRefreshQueued = false;
    let badgeRefreshInFlight = null;
    const pendingResources = new Set();
    let feedFailures = 0;
    let badgeFailures = 0;
    const refreshWorkoutFeed = (force = false) => {
      if (!live || routeRef.current.name !== 'friends' || (!force && !storeRefA.current?.friends)) return Promise.resolve();
      if (feedRefreshInFlight) {
        feedRefreshQueued = feedRefreshQueued || force;
        return feedRefreshInFlight;
      }
      feedRefreshInFlight = LB.loadSocialWorkoutFeed().then(feed => {
        if (!live) return;
        feedFailures = 0;
        setStore(s => s?.friends ? { ...s, friends: { ...s.friends, ...feed } } : s);
      }).catch(() => { feedFailures += 1; }).finally(() => {
        feedRefreshInFlight = null;
        if (feedRefreshQueued && live) {
          feedRefreshQueued = false;
          setTimeout(() => refreshWorkoutFeed(true), 0);
        }
      });
      return feedRefreshInFlight;
    };
    const refreshMessages = (force = false) => {
      if (!live) return Promise.resolve();
      if (messageRefreshInFlight) {
        messageRefreshQueued = messageRefreshQueued || force;
        return messageRefreshInFlight;
      }
      messageRefreshInFlight = LB.loadSocialMessageState(userId).then(messageState => {
        if (!live) return;
        setStore(s => s?.friends ? { ...s, friends: { ...s.friends, ...messageState } } : s);
      }).catch(() => {}).finally(() => {
        messageRefreshInFlight = null;
        if (messageRefreshQueued && live) {
          messageRefreshQueued = false;
          setTimeout(() => refreshMessages(true), 0);
        }
      });
      return messageRefreshInFlight;
    };
    const refreshBadge = () => {
      if (!live || badgeRefreshInFlight) return badgeRefreshInFlight || Promise.resolve();
      badgeRefreshInFlight = LB.loadSocialBadge().then(badge => {
        badgeFailures = 0;
        if (live) setStore(s => s ? { ...s, friends: { ...(s.friends || {}), ...badge } } : s);
      }).catch(() => { badgeFailures += 1; }).finally(() => { badgeRefreshInFlight = null; });
      return badgeRefreshInFlight;
    };
    const refreshFriends = (force = false) => {
      if (!live) return Promise.resolve();
      if (socialRefreshInFlight) {
        socialRefreshQueued = socialRefreshQueued || force;
        return socialRefreshInFlight;
      }
      socialRefreshInFlight = LB.loadFriendsState(userId, LB.socialWeekStartISO(), { force }).then(friends => {
        if (!live) return;
        setStore(s => s ? {
          ...s,
          friends: {
            ...friends,
            liveWorkouts: s.friends?.liveWorkouts || [],
            workoutHistory: s.friends?.workoutHistory || [],
          },
        } : s);
        // Feed summaries are intentionally staged after Circle and Groups
        // have their core data, so the first render is not feed-bound.
        if (routeRef.current.name === 'friends') refreshWorkoutFeed(true);
      }).catch(() => {}).finally(() => {
        socialRefreshInFlight = null;
        if (socialRefreshQueued && live) {
          socialRefreshQueued = false;
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => refreshFriends(true), 250);
        }
      });
      return socialRefreshInFlight;
    };
    if (route.name === 'friends') {
      if (!storeRefA.current?.friends?.loadedAt) refreshFriends();
    } else {
      refreshBadge();
    }
    const nextFailureDelay = failures => [5000, 10000, 30000, 60000][Math.min(Math.max(failures - 1, 0), 3)];
    const scheduleFeed = delay => {
      clearTimeout(feedTimer);
      if (!live || routeRef.current.name !== 'friends') return;
      feedTimer = setTimeout(async () => {
        await refreshWorkoutFeed();
        scheduleFeed(feedFailures ? nextFailureDelay(feedFailures) : 10000);
      }, delay);
    };
    if (route.name === 'friends') scheduleFeed(10000);

    const scheduleBadge = delay => {
      clearTimeout(badgeTimer);
      if (!live || routeRef.current.name === 'friends') return;
      badgeTimer = setTimeout(async () => {
        await refreshBadge();
        scheduleBadge(badgeFailures ? nextFailureDelay(badgeFailures) : 120000 + Math.floor(Math.random() * 15001));
      }, delay);
    };
    if (route.name !== 'friends') scheduleBadge(120000 + Math.floor(Math.random() * 15001));

    const flushResources = () => {
      refreshTimer = null;
      const resources = new Set(pendingResources);
      pendingResources.clear();
      if (routeRef.current.name !== 'friends') {
        refreshBadge();
        return;
      }
      const onlyTargeted = [...resources].every(resource => resource === 'messages' || resource === 'feed');
      if (!onlyTargeted || resources.has('authoritative')) refreshFriends(true);
      else {
        if (resources.has('messages')) refreshMessages(true);
        if (resources.has('feed')) refreshWorkoutFeed(true);
      }
    };
    const unsubscribe = LB.subscribeToFriends(userId, resource => {
      pendingResources.add(resource || 'dashboard');
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(flushResources, 250);
    }, { transport: runtimeConfig.socialTransport });
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      pendingResources.add('authoritative');
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(flushResources, 250);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      clearTimeout(refreshTimer);
      clearTimeout(feedTimer);
      clearTimeout(badgeTimer);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe?.();
    };
  }, [userId, friendsDataEnabled, runtimeConfig.socialTransport, route.name]);

  useEffectA(() => {
    if (phase === 'ready' && route.name === 'friends' && !friendsTabEnabled) go({ name: 'home' });
  }, [phase, route.name, friendsTabEnabled]);

  // Sync to Supabase + save to localStorage on every store change.
  // A failed sync leaves syncBase unchanged so the pending diff is retried later.
  useEffectA(() => {
    if (!store || !userId || phase !== 'ready') return;
    prevStore.current = store;
    pendingStore.current = store;
    if (store !== syncBase.current) setSyncStatus('pending');
    flushSync(userId);
    // Full-store serialization is debounced and moved into idle time. The
    // snapshot helper also avoids a second base serialization once the cache
    // and confirmed server state are identical.
    scheduleLocalSave();
  }, [store, scheduleLocalSave]);

  // Flushes a pending idle localStorage save immediately so a background kill
  // or tab close cannot drop the latest local edit.
  useEffectA(() => {
    const flushLocalSave = () => { persistLocalNow(); };
    const onVisibilityHidden = () => { if (document.hidden) flushLocalSave(); };
    window.addEventListener('pagehide', flushLocalSave);
    document.addEventListener('visibilitychange', onVisibilityHidden);
    return () => {
      window.removeEventListener('pagehide', flushLocalSave);
      document.removeEventListener('visibilitychange', onVisibilityHidden);
    };
  }, [persistLocalNow]);

  // Check for SW updates on every screen navigation and whenever the app
  // comes back to the foreground (visibilitychange). Fetches sw.js directly
  // from the network (bypassing the SW cache via ?_v=) and compares the CACHE
  // version string. iOS Safari ignores reg.update() when the app is in the
  // foreground, so this is the only reliable detection path.
  // Skipped entirely while on the training screen, never risk nudging
  // someone mid-workout, even indirectly (a background swReg.update() can
  // still be surprising). This means a user who lives almost entirely on
  // 'train' can go a long time without a successful check; that tradeoff is
  // deliberate. The admin-triggered force-update path (checkForceUpdate
  // below) intentionally does NOT have this guard, so a manual broadcast can
  // still reach everyone promptly.
  const checkSwUpdate = useCallbackA(() => {
    if (routeRef.current?.name === 'train') return;
    // Resolve sw.js relative to the SW scope (or page URL before registration
    // settles), works on both github.io/training/ and the zane-wo.com root.
    const swUrl = new URL('sw.js', swReg.current?.scope || window.location.href);
    fetch(`${swUrl}?_v=${Date.now()}`)
      .then(r => r.text())
      .then(text => {
        const m = text.match(/const CACHE = '([^']+)'/);
        if (!m) return;
        const v = m[1];
        // Persist the last-seen version to localStorage so cold starts (iOS
        // terminates PWA, clears in-memory state) still detect stale caches.
        // An in-memory ref would always start null after a cold start, making
        // the first fetch a no-op that "consumes" the update without showing
        // the banner, the user would never see it.
        let stored = null;
        try { stored = localStorage.getItem('logbook-sw-version'); } catch (_) {}
        if (!stored) {
          // First sighting: record the running version as the baseline so a
          // later, newer sw.js is recognised as an update. Nothing to compare
          // against yet, so no banner.
          try { localStorage.setItem('logbook-sw-version', v); } catch (_) {}
          return;
        }
        if (v !== stored && isNewerSwVersion(v, stored)) {
          // An update is available. Do NOT advance the stored version here,
          // only applyUpdate persists it. Otherwise after an iOS cold start
          // (in-memory state wiped) stored would already equal v and the
          // update would never be re-offered.
          pendingSwVersion.current = v;
          if (!isDeferredUpdateKey(v)) setUpdateAvailable(true);
          swReg.current?.update().catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  // Lets the admin push the update banner to everyone without an sw.js cache
  // bump (see admin_force_update). Same "first sighting = baseline, no
  // banner" pattern as checkSwUpdate above, a brand-new device must never
  // see a false "update available" for a nonce it's never seen before.
  // Deliberately runs regardless of route (including 'train'), this is the
  // one deliberate, admin-triggered broadcast, so it's allowed to reach a
  // training user promptly. checkSwUpdate above keeps the route guard so
  // routine version bumps never even risk nudging someone mid-workout.
  const checkForceUpdate = useCallbackA(() => {
    // Skip pre-login: anon has no EXECUTE on this RPC by design (correct,
    // verified live, matches schema.sql), so polling before phase is 'ready'
    // just logs a guaranteed permission-denied server-side for no reason.
    // Nobody's watching for a force-update broadcast before they're signed in.
    if (phaseRef.current !== 'ready') return;
    return LB.fetchRuntimeConfig().then(config => {
      const data = config?.forceUpdateNonce;
      if (!data) return;
      let stored = null;
      try { stored = localStorage.getItem('logbook-force-nonce-seen'); } catch (_) {}
      if (!stored) {
        try { localStorage.setItem('logbook-force-nonce-seen', data); } catch (_) {}
        return;
      }
      if (data !== stored) {
        pendingForceNonce.current = data;
        if (!isDeferredUpdateKey(`force:${data}`)) setUpdateAvailable(true);
      }
    }).catch(() => {});
  }, []);

  useEffectA(() => { checkSwUpdate(); checkForceUpdate(); }, [route]);

  useEffectA(() => {
    if (phase !== 'ready' || !userId) return;
    let live = true;
    let timer = null;
    const poll = async () => {
      await checkForceUpdate();
      if (live) timer = setTimeout(poll, 120000);
    };
    timer = setTimeout(poll, 120000);
    return () => { live = false; clearTimeout(timer); };
  }, [phase, userId, checkForceUpdate]);

  // "Later" is deliberately a one-home-visit deferral. The banner stays out
  // of an editor or another tab, then returns when the user actually enters
  // Home again, where applying it cannot discard the flow they were in.
  useEffectA(() => {
    const previous = previousRouteName.current;
    previousRouteName.current = route.name;
    if (route.name !== 'home' || previous === 'home') return;
    if (!readDeferredUpdate()) return;
    writeDeferredUpdate(null);
    setUpdateAvailable(true);
  }, [route.name]);

  useEffectA(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') { checkSwUpdate(); checkForceUpdate(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Connectivity tracking: offline → red immediately, online → retry or clear
  useEffectA(() => {
    const onOffline = () => setSyncStatus('error');
    const onOnline  = () => {
      if (!userId) return;
      if (pendingStore.current !== syncBase.current) flushSync(userId);
      else setSyncStatus('synced');
    };
    if (!navigator.onLine) setSyncStatus('error');
    window.addEventListener('offline', onOffline);
    window.addEventListener('online',  onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online',  onOnline);
    };
  }, [userId, flushSync]);

  // Keep nextReminderAt in sync whenever reminder settings or schedule state changes.
  useEffectA(() => {
    if (!store || phase !== 'ready') return;
    if (!store.settings?.reminderEnabled) {
      if (store.nextReminderAt != null) setStore(s => ({ ...s, nextReminderAt: null }));
      return;
    }
    const computed = LB.computeNextReminderAt(store);
    if (computed !== (store.nextReminderAt ?? null)) {
      setStore(s => ({ ...s, nextReminderAt: computed }));
    }
  }, [
    store?.settings?.reminderEnabled,
    store?.settings?.reminderTime,
    store?.activeScheduleId,
    store?.cycleStartDate,
    store?.lastAdvancedDate,
    store?.inProgress,
    // computeNextReminderAt walks the active plan's days and the logged
    // sessions to find the next training day, so editing the plan (moving a
    // day, adding a rest day) or logging a workout changes the answer. Without
    // these the stored reminder kept pointing at the old day until one of the
    // scalars above happened to change.
    store?.schedules,
    store?.sessions,
    store?.cycleIndex,
    store?.weekPlanStartDate,
  ]);

  // Live client training status + check-in status, driving the coaching
  // badge. Primary updates come from the realtime listeners wired into the
  // subscribeToChanges effect above (via pollFnRef/triggerPoll); this
  // interval is only the fallback for a dropped/reconnecting channel, so it
  // can be slow, it's a safety net.
  const isCoachActive = phase === 'ready' && (store?.coaching?.asCoach || []).some(c => c.status === 'active');
  const prevAnyLiveRef = useRefA(false);
  const prevPendingRef = useRefA(0);
  useEffectA(() => {
    if (!isCoachActive) { pollFnRef.current = null; return; }
    const poll = () => {
      Promise.all([LB.loadCoachClientsStatus(), LB.loadCoachCheckinStatus()])
        .then(([statusData, checkinData]) => {
          const anyLive = statusData.some(r => r.inProgressSessionId);
          setStore(s => {
            if (!s) return s;
            const asCoach = s.coaching?.asCoach || [];
            const pendingCheckinsCount = checkinData.filter(r => {
              if (r.checkedInAt !== null) return false;
              const client = asCoach.find(c => c.id === r.coachingId);
              return client?.checkinEnabled ?? true;
            }).length;
            if (anyLive === prevAnyLiveRef.current && pendingCheckinsCount === prevPendingRef.current) return s;
            prevAnyLiveRef.current = anyLive;
            prevPendingRef.current = pendingCheckinsCount;
            return { ...s, coaching: { ...s.coaching, anyClientLive: anyLive, pendingCheckinsCount } };
          });
        })
        .catch(() => {});
    };
    pollFnRef.current = poll;
    poll();
    const iv = setInterval(poll, 60000);
    return () => { clearInterval(iv); pollFnRef.current = null; };
  }, [isCoachActive]);

  // Exposed globally so Settings → How to… can launch any tour.
  // Also clears WhatsNew so it doesn't block the tour overlay (z-index).
  window.__startTour = (tourKey) => { setWhatsNew(null); setOnboardingState({ phase: 'tour', tourKey }); };

  if (phase === 'init' || phase === 'loading') return <LoadingScreen />;
  if (phase === 'unauthed') return <window.Screens.LoginScreen />;
  if (phase === 'invite') return <window.Screens.SetPasswordScreen isRecovery={isRecoveryFlow.current} onDone={() => loadData(userId)} />;
  if (phase === 'error') return <ErrorScreen onRetry={() => window.location.reload()} />;

  const go = async (r) => {
    const cur = routeRef.current;
    // While FoodScreen is mounted it registers __foodLeaveGuard: any
    // navigation away from the current route asks it first, so a staged
    // batch is never dropped silently (the same "Discard picks?" dialog
    // the back button already used). With no guard registered this stays
    // a fully synchronous setRoute, unchanged for every other screen.
    if (window.__foodLeaveGuard && r.name !== cur.name) {
      const ok = await window.__foodLeaveGuard();
      if (!ok) return false;
    }
    const updateRoute = () => setRoute(r);
    // Keep the current frame responsive while React mounts the next screen.
    // The TabBar has its own immediate visual state, so its indicator does not
    // wait for this lower-priority render to commit.
    if (typeof React.startTransition === 'function') React.startTransition(updateRoute);
    else updateRoute();
    return true;
  };
  // Global hook so shared components (TopBar/ScreenHead long-press-to-home)
  // can jump home without threading `go` through every screen that renders them.
  window.__goHome = () => go({ name: 'home' });
  const onRetrySync = () => { setStorageFull(false); flushSync(userId); };

  // An update may be installed while the user is anywhere in the app, but a
  // reload is only safe on a quiet Home surface. Route checks protect editors;
  // the sheet and focus checks protect quick actions and unsaved text entry.
  const safeToApplyUpdate = route?.name === 'home'
    && !store?.inProgress
    && !onboardingState
    && openSheetCount === 0
    && !textEntryFocused;

  const props = { store, setStore, go, userId, runtimeConfig, syncStatus, storageFull, onRetrySync, flushBeforeSignOut, markIntentionalSignOut };
  const tabRoutes = ['home', 'plan', 'lib', 'cardio-plans', 'hist', 'health', 'water', 'food', 'medications', 'coaching', 'friends'];
  const showTab = tabRoutes.includes(route.name);
  // Library and cardio-plans live under the merged "Plan" tab; the water,
  // food and (opt-in) medications trackers live under the Health tab: keep
  // the right tab lit for each.
  const tabActive = (route.name === 'lib' || route.name === 'cardio-plans') ? 'plan'
    : (route.name === 'water' || route.name === 'food' || route.name === 'medications') ? 'health'
    : (route.name === 'coaching' || route.name === 'friends') ? 'social'
    : route.name;
  const showMeds = !!store?.settings?.medsEnabled;

  const showCoaching = !!(
    store?.settings?.showCoachingTab ||
    (store?.settings?.beYourOwnCoach && store?.coaching?.asSelf) ||
    (store?.coaching?.asCoach || []).filter(c => c.status === 'active').length > 0 ||
    store?.coaching?.asClient?.status === 'active'
  );
  const showHealth = !!store?.settings?.showHealthTab;
  const showWater = !!store?.settings?.showWaterTab;
  const showFood = !!store?.settings?.showFoodTab;
  const showFriends = !!store?.settings?.showFriendsTab;
  const coachingUnread = (store?.coaching?.unreadNotes || []).length;
  const pendingCheckinsCount = store?.coaching?.pendingCheckinsCount || 0;
  const coachingBadge = showCoaching ? { count: coachingUnread + pendingCheckinsCount, live: !!store?.coaching?.anyClientLive } : null;
  const friendsBadge = showFriends && runtimeConfig.socialMode === 'normal' ? {
    count: (store?.friends?.unreadCount || 0) + (store?.friends?.incomingCount ?? store?.friends?.incoming?.length ?? 0),
  } : null;

  let screen;
  switch (route.name) {
    case 'home':          screen = <window.Screens.HomeScreen {...props} />; break;
    case 'plan':          screen = <window.Screens.PlanScreen {...props} openNewPlan={route.openNewPlan} />; break;
    case 'plan-view':     screen = <window.Screens.PlanViewerScreen {...props} scheduleId={route.scheduleId} fromPlan={route.fromPlan} />; break;
    case 'schedule-new':  screen = <window.Screens.ScheduleNewScreen {...props} />; break;
    case 'schedule-programs': screen = <window.Screens.StructuredProgramsScreen {...props} />; break;
    case 'schedule-templates': screen = <window.Screens.ProgramTemplatesScreen {...props} />; break;
    case 'schedule-531':  screen = <window.Screens.FiveThreeOneSetupScreen {...props} />; break;
    case 'plan-preview':  screen = <window.Screens.ProgramPreviewScreen {...props} programId={route.programId} />; break;
    case 'schedule-edit': screen = <window.Screens.ScheduleEditScreen {...props} scheduleId={route.scheduleId} versionFrom={route.versionFrom} openDayId={route.openDayId} />; break;
    case 'train':         screen = <window.Screens.TrainingScreen {...props} sessionId={route.sessionId} />; break;
    case 'lib':           screen = <window.Screens.LibraryScreen {...props} />; break;
    case 'cardio-plans':  screen = <window.Screens.CardioPlanScreen {...props} />; break;
    case 'exercise':      screen = <window.Screens.ExerciseDetailScreen key={route.exId} {...props} exId={route.exId} back={route.back} editQueue={route.editQueue || []} editQueueTotal={route.editQueueTotal || 0} autoEdit={!!route.autoEdit} />; break;
    case 'hist':          screen = <window.Screens.HistoryScreen {...props} initialTab={route.initialTab} />; break;
    case 'health':        screen = <window.Screens.HealthScreen {...props} openMacroTargets={route.openMacroTargets} />; break;
    case 'water':         screen = <window.Screens.WaterScreen {...props} />; break;
    case 'food':          screen = <window.Screens.FoodScreen {...props} date={route.date} />; break;
    case 'medications':   screen = <window.Screens.MedicationsScreen {...props} />; break;
    case 'session':          screen = <window.Screens.SessionDetailScreen {...props} sessionId={route.sessionId} justFinished={route.justFinished} back={route.back} />; break;
    case 'compare':          screen = <window.Screens.SessionCompareScreen {...props} sessionId={route.sessionId} compareId={route.compareId} back={route.back} />; break;
    case 'exerciseHistory':  screen = <window.Screens.ExerciseHistoryScreen {...props} exId={route.exId} dayId={route.dayId} exName={route.exName} back={route.back} />; break;
    case 'settings':          screen = <window.Screens.SettingsScreen {...props} openSupportInbox={route.openSupportInbox} openSupportSheet={route.openSupportSheet} onTestUpdateBanner={() => { setForceShowUpdateBanner(true); go({ name: 'home' }); }} />; break;
    case 'featuremap':        screen = <window.Screens.FeatureMapScreen {...props} />; break;
    case 'autoreg-guide':     screen = <window.Screens.AutoregGuideScreen {...props} mode={route.mode} back={route.back} />; break;
    case 'spectator':         screen = <window.Screens.SpectatorScreen {...props} targetUserId={route.targetUserId} userName={route.userName} sessionId={route.sessionId} back={route.back} />; break;
    case 'coaching':            screen = <window.Screens.CoachingTabScreen {...props} initialClientTab={route.initialClientTab} />; break;
    case 'friends':             screen = runtimeConfig.socialMode === 'maintenance'
      ? <window.Screens.FriendsMaintenanceScreen {...props} />
      : <window.Screens.FriendsScreen {...props} initialTab={route.initialTab} />; break;
    case 'coaching-client':     screen = <window.Screens.CoachClientScreen key={route.coachingId} {...props} coachingId={route.coachingId} clientId={route.clientId} clientName={route.clientName} checkinAt={route.checkinAt} initialTab={route.initialTab} backRoute={route.backRoute || 'settings'} isSelf={route.isSelf} />; break;
    case 'coaching-edit-plan':  screen = <window.Screens.CoachPlanEditorScreen {...props} coachingId={route.coachingId} clientId={route.clientId} clientName={route.clientName} scheduleId={route.scheduleId} />; break;
    case 'coaching-new-plan':   screen = <window.Screens.CoachNewPlanScreen {...props} coachingId={route.coachingId} clientId={route.clientId} clientName={route.clientName} />; break;
    default:                  screen = <window.Screens.HomeScreen {...props} />; break;
  }

  // Expose the weight-unit label globally so UI.unit() can read it anywhere
  // (display-only; the stored numbers stay the same).
  // 'mixed' = kg weight + mi distance; __UNIT only covers the weight side.
  // Keep logbook-cardio-dist-unit in sync so all cardio screens pick up the
  // correct distance unit on boot (not just when the picker is used).
  const _u = store?.settings?.unit;
  window.__UNIT = (_u === 'lbs') ? 'lbs' : 'kg';
  if (_u === 'mixed' || _u === 'lbs') LB.setCardioDistUnit('mi');
  else if (_u === 'kg') LB.setCardioDistUnit('km');
  // Per-module opt-out: an imperial user can keep the food tracker in grams
  // (UI.massInOz reads this alongside window.__UNIT). Mirrored the same way
  // __UNIT itself is, on every render, so it's never stale behind a setting
  // change made elsewhere (e.g. a coach editing a client's own settings sync).
  window.__FOOD_FORCE_GRAMS = !!store?.settings?.foodForceGrams;

  // Deload overlay flag, buildSeedSets reads this to pre-fill loads at ~50%.
  window.__DELOAD = store?.statusMode === 'deload';

  // Cleanup-week overlay (migration 0251). Deliberately an OBJECT rather than a
  // boolean like __DELOAD: the reduction is user-set, and buildSeedSets also
  // needs sinceISO to window the seed history so the week doesn't compound its
  // own reduction. Consumers test it for null, never === true.
  // Gated on cleanupStarted, not on statusMode alone: a cleanup is activated
  // ahead of time and pinned to the next cycle start, so between activating and
  // that day the overlay must stay completely inert or the rest of the current
  // cycle would already seed reduced.
  window.__CLEANUP = LB.cleanupStarted(store)
    ? { percent: store?.settings?.cleanupPercent ?? 20, sinceISO: store?.statusModeSince ?? null }
    : null;

  // Two layout variants: the iPad sidebar layout (only on tab routes) and the
  // full-bleed layout (everything else). Navigating between a tab route and a
  // non-tab route (e.g. plan → schedule-new) flips between them on iPad.
  const layout = (isPad && showTab) ? (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <TabBar active={tabActive} routeName={route.name} onChange={(t) => go({ name: t })} sidebar showCoaching={showCoaching} coachingBadge={coachingBadge} showFriends={showFriends} friendsBadge={friendsBadge} showHealth={showHealth} showWater={showWater} showFood={showFood} showMeds={showMeds} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ErrorBoundary key={route.name} onGoHome={() => go({ name: 'home' })}>
          {screen}
        </ErrorBoundary>
      </div>
    </div>
  ) : (
    <>
      <ErrorBoundary key={route.name} onGoHome={() => go({ name: 'home' })}>
        {screen}
      </ErrorBoundary>
      {showTab && <TabBar active={tabActive} routeName={route.name} onChange={(t) => go({ name: t })} showCoaching={showCoaching} coachingBadge={coachingBadge} showFriends={showFriends} friendsBadge={friendsBadge} showHealth={showHealth} showWater={showWater} showFood={showFood} showMeds={showMeds} />}
    </>
  );

  // Overlays live OUTSIDE the layout variants at a stable tree position so they
  // never remount when navigation flips the layout on iPad. Remounting
  // OnboardingTour mid-tour would reset its step counter, that was the
  // "3/10 → 4/10 → snaps back to 1/10" bug when the tour navigated from the
  // plan tab (sidebar layout) to schedule-new (full-bleed layout).
  return (
    <>
      {layout}
      {/* The compact notice can reach an active flow without blocking it. The
          full modal only appears on Home, where Update Now is safe. */}
      {(forceShowUpdateBanner || updateAvailable) && !onboardingState && (
        <UpdateBanner
          compact={!safeToApplyUpdate}
          onUpdate={applyUpdate}
          onDefer={deferUpdate}
          updating={updateApplying}
        />
      )}
      {autoCloseNotify && <AutoCloseBanner notify={autoCloseNotify} onDismiss={() => setAutoCloseNotify(null)} />}
      {whatsNew && <WhatsNewModal entries={whatsNew} onDismiss={dismissWhatsNew} />}
      {store && <window.Screens.CoachingPendingBanner store={store} setStore={setStore} userId={userId} />}
      {store && friendsTabEnabled && route.name !== 'train' && <window.Screens.FriendRequestBanner store={store} setStore={setStore} userId={userId} />}
      {onboardingState?.phase === 'prompt' && (
        <window.Screens.OnboardingPrompt
          onStart={() => setOnboardingState({ phase: 'tour', tourKey: 'createPlan' })}
          onSkip={() => { setOnboardingState(null); setStore(s => s ? { ...s, settings: { ...s.settings, onboardingCompleted: true } } : s); }}
        />
      )}
      {onboardingState?.phase === 'tour' && (
        <window.Screens.OnboardingTour
          tourKey={onboardingState.tourKey}
          go={go}
          route={route}
          onDone={() => { setOnboardingState(null); go({ name: 'home' }); setStore(s => s ? { ...s, settings: { ...s.settings, onboardingCompleted: true } } : s); }}
        />
      )}
      {unitPromptOpen && window.Screens?.UnitPromptModal && (
        <window.Screens.UnitPromptModal
          onDone={(chosenUnit) => {
            unitPicked.current = true; // latch before setStore so the reset watcher won't re-null
            setUnitPromptOpen(false);
            setStore(s => s ? { ...s, settings: { ...s.settings, unit: chosenUnit } } : s);
          }}
        />
      )}
      {xHandlePromptOpen && window.Screens?.XHandlePrompt && (
        <window.Screens.XHandlePrompt
          onSave={(handle) => {
            setXHandlePromptOpen(false);
            setStore(s => s ? { ...s, user: {
              ...s.user,
              xHandle: handle,
              xHandlePublic: s.user?.xHandlePublic !== false,
              // The prompt is a one-time request. Saving a handle completes it
              // permanently, even if the profile write is briefly delayed.
              xHandlePromptOptedOut: true,
            } } : s);
          }}
          onLater={() => {
            setXHandlePromptOpen(false);
            setStore(s => s ? { ...s, user: {
              ...s.user,
              // "Later" means this one-time prompt has been handled; do not
              // bring it back on the next boot.
              xHandlePromptOptedOut: true,
            } } : s);
          }}
          onOptOut={() => {
            setXHandlePromptOpen(false);
            setStore(s => s ? { ...s, user: {
              ...s.user,
              xHandle: null,
              xHandlePublic: false,
              xHandlePromptOptedOut: true,
            } } : s);
          }}
        />
      )}
      {pendingShare && store && window.Screens?.RecipeShareSheet && (
        <window.Screens.RecipeShareSheet
          store={store} setStore={setStore} token={pendingShare}
          onClose={() => {
            try { localStorage.removeItem(PENDING_SHARE_KEY); } catch (_) {}
            setPendingShare(null);
          }}
        />
      )}
    </>
  );
}

function tryMount() {
  if (window.LB && window.Screens?.LoginScreen && window.Screens?.HomeScreen &&
      window.Screens?.LibraryScreen && window.Screens?.TrainingScreen &&
      window.Screens?.SettingsScreen) {
    ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  } else {
    setTimeout(tryMount, 50);
  }
}
tryMount();
