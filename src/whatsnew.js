/* ─── What's New — changelog history ────────────────────────────────────────
   The full announcement history lives here, NEWEST FIRST. app.jsx reads
   window.WHATS_NEW and shows every entry the user hasn't seen yet, bundled into
   a single card — so someone returning after skipping several releases catches
   up on everything at once. See CLAUDE.md "What's New / Changelog".

   To announce something (ONLY on the user's request):
     1. Add a new entry to the TOP of the array with a fresh, unique `id`.
     2. Bump the sw.js cache version so the update ships.
   Never remove old entries — they are the history returning users catch up on.
   Write the texts well: what's new, what it does for the user, how to use it —
   crisp bullet points, no tech jargon, no internal names. Leave the array
   empty ([]) to show nothing.

   Entry shape: { id: string, title: string, items: string[] } */
window.WHATS_NEW = [
  {
    id: 'v2.220',
    title: 'Settings Redesign, Training Tools & No Interruptions',
    items: [
      'Sorry — that won\'t happen again. 😄 Update banners now wait until your session is done — your workout will never be interrupted again.',
      'The update still installs silently in the background. The banner reappears the moment you finish or cancel your session.',
      'Settings reorganised — Coaching, Account, Training, Appearance and Data each open their own screen. Much cleaner to navigate.',
      'Drag to reorder — cycle days, exercises within a day, and check-in form fields can all be reordered by dragging. Hold briefly on touch, click and drag on desktop. No more tiny arrow buttons.',
      'Plate inventory — tell the app which plates your gym has under Settings → Training → Plate inventory. The plate calculator only suggests plates you actually own, and it works in kg and lbs.',
      'Plate calculator — tap the dumbbell icon on the weight keyboard while entering a set weight to see exactly which plates go on the bar.',
      'Equipment setup — increments and max weights per equipment type now live at Settings → Training → Equipment setup, accessible without enabling Smart Progression.',
      'Rest timer expired — returning to the Train screen after the rest period already ran out now shows a clear alert instead of silent confusion.',
    ],
  },
  {
    id: 'v2.212',
    title: 'Settings Redesign & Training Tools',
    items: [
      'Settings reorganised — Coaching, Account, Training, Appearance and Data each open their own screen. Much cleaner to navigate.',
      'Drag to reorder — cycle days, exercises within a day, and check-in form fields can all be reordered by dragging. Hold briefly on touch, click and drag on desktop. No more tiny arrow buttons.',
      'Plate inventory — tell the app which plates your gym has under Settings → Training → Plate inventory. The plate calculator only suggests plates you actually own, and it works in kg and lbs.',
      'Plate calculator — tap the dumbbell icon on the weight keyboard while entering a set weight to see exactly which plates go on the bar.',
      'Equipment setup — increments and max weights per equipment type now live at Settings → Training → Equipment setup, accessible without enabling Smart Progression.',
      'Rest timer expired — returning to the Train screen after the rest period already ran out now shows a clear alert instead of silent confusion.',
    ],
  },
  {
    id: 'v2.186',
    title: 'Drag to reorder',
    items: [
      'Cycle days, exercises in a day, and check-in form fields can now be reordered by dragging — no more tiny arrow buttons.',
      'On touch: hold briefly, then drag. On desktop: click and drag. A drop line shows exactly where the item will land.',
      'Check-in form builder: drag sections and individual fields independently of each other.',
      'Dev note: those little up/down arrows cost me my last nerve, so they had to go.',
    ],
  },
  {
    id: 'v2.181',
    title: 'Your cardio bests, celebrated',
    items: [
      'Log a cardio session that beats your history and the app marks the moment — a full-screen ★ NEW BEST for a new fastest pace, longest distance or longest session.',
      'Bests are tracked per activity type, so your runs are measured against runs and your rides against rides — never mixed.',
      'Didn\'t break a record? You\'ll still get an ↑ IMPROVEMENT flash when you beat your most recent session of the same type.',
    ],
  },
  {
    id: 'v2.180',
    title: 'Custom check-ins — now with preview',
    items: [
      'Build a fully custom weekly check-in form: add your own fields, group them into sections, pick scales, icons and exactly what your clients report.',
      'New: preview your form before anyone fills it in — a sample weekly check-in and 20 weeks of trend charts populate live as you edit.',
      'Everything your client submits now follows your form end to end — the weekly summary, the trend charts and the shared progress image all reflect your custom fields.',
      'Apply one form to all clients with a tap, or override it per client. "Be your own coach" users get the full builder too.',
    ],
  },
  {
    id: 'v2.161',
    title: 'Your Coaching, Your Rules',
    items: [
      'Build a fully custom weekly check-in form: add your own fields, group them into sections, set scales, choose icons and control exactly what your clients report each week.',
      'Design your form once and apply it to all clients with one tap — or override it individually for clients who need a different setup.',
      'The form builder guides you through every option with inline explanations and a visual icon picker with 50+ fitness icons, so there\'s no guesswork.',
      '"Be your own coach" users can now customise their personal check-in form too — the full builder is available right from the check-in tab.',
    ],
  },
  {
    id: 'v2.134',
    title: 'Cardio & Mobility',
    items: [
      'Log cardio two ways: tap CARDIO on the home screen for a quick standalone log, or add the CARDIO exercise to any training day — it saves to your cardio history automatically when the session ends. Cardio never counts toward volume or workout streaks.',
      'Track activity type, duration, distance (km or mi), pace feeling and effort. Your most-used activity types appear as quick-select chips. Full history under History → Cardio, with your weekly totals auto-filling the check-in form.',
      'Tap any activity type in your cardio history to open a progression chart — Duration, Speed, Effort, Pace Feeling and Distance plotted over time, so you can see trends at a glance.',
      'New Mobility exercise type for stretching and flexibility work: excluded from training volume. Choose whether to log weight & reps or just tick a checkbox — no set-by-set tracking. Creating a Mobility exercise automatically sets equipment to No equipment.',
      'Charts across the app now show axis lines for cleaner reading. Various fixes: rest timer audio and Pushover notifications restored, plan editor handles cardio correctly.',
    ],
  },
  {
    id: 'v2.087',
    title: 'Fast start, no matter how long you\'ve trained',
    items: [
      'The app now starts equally fast whether you logged in last week or have years of training behind you — opening time and memory use no longer grow with your history.',
      'Your full history is still all there: stats, personal records and charts stay exact, and older sessions load their details the moment you open them.',
      'Everything still works fully offline — your recent training is ready instantly, even without a connection.',
    ],
  },
  {
    id: 'v2.083',
    title: 'A big reliability tune-up',
    items: [
      'You can now see when your data is still saving. Make changes offline and a small "not synced" marker appears, then clears itself the moment you\'re back online — so nothing slips through unsaved.',
      'App updates install reliably now — when a new version is ready you\'ll be prompted to refresh, no matter how you opened the app.',
      'Your training day now rolls over at your local midnight, so the day shown late at night or early in the morning is always the correct one.',
      'Under the hood: tighter security around notifications and coaching messages, and new safeguards that catch saving glitches before they ever reach you.',
    ],
  },
  {
    id: 'v2.072',
    title: 'Smarter progression — always aim higher',
    items: [
      'The app now anchors your next session on your best recent performance, not just the last one — so a tough day never drags your progression backwards.',
      'Smart Progression and the pre-filled values both use the same anchor: the best set you\'ve done at the current weight over your last 3 sessions, position by position.',
      'Hit a new personal record mid-session? You\'ll know — a brief flash of ★ NEW BEST marks the moment your all-time e1RM is broken.',
    ],
  },
  {
    id: 'v2.068',
    title: 'Faster, offline & flexible plans',
    items: [
      'The app now starts much faster and works fully offline — open it anytime, even without a connection, and your training is right there.',
      'Plans keep a dated version history. Change your split from any date you choose, and browse, edit, or restore each version separately — right from the plan view.',
      "Coaching: while following a client's live session you can now scroll through their whole workout freely — tap LIVE to jump back to the exercise they're on right now.",
    ],
  },
];
