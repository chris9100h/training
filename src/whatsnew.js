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
    id: 'v2.118',
    title: 'Cardio in your training plan',
    items: [
      'Add the CARDIO block to any training day in your plan — ideal if cardio is already part of your routine.',
      'When you reach it during a session, pick your activity (Running, Cycling, Rowing and more), then log duration, distance and effort.',
      'Done — the data lands straight in your cardio history. No double-logging.',
      'Cardio blocks never count toward your training volume or workout streaks.',
    ],
  },
  {
    id: 'v2.115a',
    title: 'Cardio Logging',
    items: [
      'Log cardio directly in the app — running, cycling, whatever you do.',
      'Track duration, distance (km or mi), pace feeling and effort per session.',
      'Quick-log via the CARDIO button on the home screen; full history under History → Cardio.',
      'Check-in forms auto-fill with your cardio data from the week.',
    ],
  },
  {
    id: 'v2.115b',
    title: 'Mobility & Fixes',
    items: [
      'New "Mobility" exercise type for stretching and mobility work — excluded from training volume.',
      'Rest timer audio and Pushover notifications working reliably again.',
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
