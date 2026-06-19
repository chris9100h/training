/* ─── What's New — changelog history ────────────────────────────────────────
   The full announcement history lives here, NEWEST FIRST. app.jsx reads
   window.WHATS_NEW and shows every entry the user hasn't seen yet, bundled into
   a single card — so someone returning after skipping several releases catches
   up on everything at once. See CLAUDE.md "What's New / Changelog".

   To announce something (ONLY on the user's request):
     1. Add a new entry to the TOP of the array with a fresh, unique `id`.
     2. Bump the sw.js cache version so the update ships.
   Never remove entries that cover unique features — they are the history returning users catch up on.
   Redundant entries (fully subsumed by a newer one) may be removed to keep the changelog clean.
   Write the texts well: what's new, what it does for the user, how to use it —
   crisp bullet points, no tech jargon, no internal names. Leave the array
   empty ([]) to show nothing.

   Entry shape: { id: string, title: string, items: string[] } */
window.WHATS_NEW = [
  {
    id: 'v2.378',
    title: 'Sick & Vacation Mode',
    items: [
      'Set your status to Sick or Vacation in the Health tab — while active, no macro adherence is tracked and your home screen reflects your current state instead of showing a training prompt.',
      'Your coach (or self-coaching dashboard) sees the status directly in the client list and overview, including how many days you\'ve been out.',
      'Activate retroactively: tap any past day in Health before switching on the mode and that date becomes the start — up to two weeks back.',
      'The period is counted separately in History → Stats under Consistency, alongside a new "Missed Workouts" card — worth a look if you haven\'t been there yet.',
    ],
  },
  {
    id: 'v2.376',
    title: 'Install Zane as an app',
    items: [
      'A new step-by-step guide walks you through adding Zane to your home screen on iPhone or Android — find it under Settings → How to… → Install as app.',
      'Once installed, Zane opens full-screen without a browser bar, loads instantly, and push notifications work reliably in the background.',
      'iPhone users: the guide is also linked directly in the Push notifications setup, since installation is required for push to work on iOS.',
    ],
  },
  {
    id: 'v2.375',
    title: 'Push Notifications Redesigned',
    items: [
      'Pushover has been replaced by native Web Push — rest timer alerts, coaching messages, and training reminders now all work without a third-party app.',
      'To get started, enable push for this device under Account → Push notifications → This device.',
      'Notifications reach you on the locked screen as long as Zane is installed on your home screen (PWA).',
      'Prefer Pushover? Re-activate it under Account → Push notifications → Advanced — a quick verification confirms your setup.',
    ],
  },
  {
    id: 'v2.373',
    title: 'Sign in with your face or fingerprint',
    items: [
      'Passkeys replace your password with Face ID, Touch ID or your device PIN — nothing to remember, nothing to type.',
      'Set one up under Settings → Account → Passkeys → Add passkey. Takes five seconds.',
      'Each device can have its own passkey — phone, tablet, laptop — and you can remove old ones whenever you want.',
      'Your password still works as a fallback, so nothing breaks if you skip this.',
    ],
  },
  {
    id: 'v2.371',
    title: 'Forgot your password?',
    items: [
      'A "Forgot password?" link now appears below the login button — tap it, enter your email, and you\'ll receive a reset link within seconds.',
      'The link takes you straight to a password reset screen where you can set a new password and log back in immediately.',
    ],
  },
  {
    id: 'v2.369',
    title: 'Drag to reorder exercises',
    items: [
      'Long-press any exercise chip during a session to drag it to a new position — works on touch and desktop',
      'The session summary detects reorders and shows exactly which exercise moved where; "Update plan" saves the new order',
      'Exercise and muscle group dropdowns are now sorted alphabetically',
    ],
  },
  {
    id: 'v2.368',
    title: 'Training screen: set controls redesigned',
    items: [
      'Add Set, Remove Set, and Check All are now three clearly labelled buttons at the bottom of the set list — no more hunting for a small icon',
      'Removed the duplicate Check Set button from the hero — the footer button is all you need',
      'Cleaner layout with more breathing room for your sets',
    ],
  },
  {
    id: 'v2.364',
    title: 'Bodyweight exercises & mid-session edits',
    items: [
      'New "Bodyweight" equipment type — assign it to pull-ups, dips, push-ups etc. Your logged body weight (Health tab) auto-fills as the seed weight, and warmup percentages are skipped.',
      'Dropdowns in the exercise creator & editor — equipment and muscle groups are now picked from a list instead of selecting a chip. Level up in tidiness.',
      'Add an exercise mid-session — new ⊕ button inserts an exercise right after your current one, seeds sets from history, and lets you optionally link it to another session exercise as a superset.',
      'Remove a wrongly added exercise — the ✕ button removes it from the session with one confirmation tap.',
      'Smarter end-of-session plan update — the diff prompt now correctly recognises added and removed exercises instead of showing false swap messages, and "Update plan" can permanently write those changes into your plan — including superset links.',
    ],
  },
  {
    id: 'v2.363',
    title: 'Colors, typing & plan history fixes',
    items: [
      '4 new accent colors: Orange, Violet, Teal, Indigo — now 10 total in a tidy 2-row grid.',
      'Text cursor no longer jumps to the end when you edit mid-word in any input field.',
      'Versioned plans: the day strip and classic cycle view now show the correct day names and dates for past cycles, even when an older version had a different number of days per cycle.',
      'Past plan versions now have an "Edit start date" button — fix a wrong start date in place, without creating a copy.',
      'Custom day type names no longer have a character limit.',
      'Fixed a crash that could leave the app stuck on an error screen after loading.',
    ],
  },
  {
    id: 'v2.352',
    title: 'Health & History Charts',
    items: [
      'Tap a workout day in History to see two charts: Effort over time and the new Volume over time — spot training trends and load progression at a glance.',
      'The weight chart in the Health tab now shows your average across the selected timeframe instead of just the latest value.',
      'The Health tab\'s Today card now shows your daily off-plan note at a glance — no need to open the log entry to see it.',
      'If your coach has configured daily tracking fields, you can now log them directly in the Health tab. When you submit your weekly check-in, each field is automatically summarised — averaged or totalled, depending on how your coach set it up.',
      'The "Exercises" tab (previously "Library") in the Plan tab is now easier to find by name.',
    ],
  },
  {
    id: 'v2.324',
    title: 'Guided Tours & Unit Preference',
    items: [
      'New guided tours in Settings → How to… — interactive walkthroughs that navigate the real app and spotlight the exact elements.',
      'Three guides available: create a training plan, do a workout, and a full tour of the Health tab.',
      'Unit system prompt: on your next login, the app asks whether you train in kg/km or lbs/mi — one tap, saved immediately.',
      'The registration form now includes the same choice so new accounts start with the right unit from day one.',
    ],
  },
  {
    id: 'v2.276',
    title: 'Weight fill-down control',
    items: [
      'When you enter a weight for a set, the app normally copies it to all remaining sets in that exercise — great for straight sets.',
      'If you train with drop sets, pyramids or varying loads per set, this automatic copy gets in the way.',
      'New toggle in Settings → Training: turn off "Fill weight down" to stop the cascade — each set keeps its own pre-filled value from last time and smart progression, but changing one set no longer overwrites the others.',
      'Default is on, so existing behaviour is unchanged.',
    ],
  },
  {
    id: 'v2.256',
    title: 'A Healthy Update',
    items: [
      'Plan and Library are now one tab with a built-in switcher — one fewer tab in the bar.',
      'The home tab is now called Train.',
      'New Health Tab — enable it under Settings → Show Health Tab.',
      'Log weight, steps, macros and water per day. Calories auto-calculate from your macros.',
      'Today card shows training and cardio status with your macro adherence bar up top.',
      'Period overview with adherence rating (Off Track → On Track → Strong Week → Perfect Week), trainings planned vs done, and macro averages with targets.',
      'Switchable between this week, last 30 and last 90 days — shared toggle with the charts.',
      'Five charts: weight, steps, macros, cardio and adherence — each with 1W / 1M / 3M.',
      'Macro targets in the chart and overview reflect what was set at the time, not your current goals.',
      'Your health data pre-fills the weekly coach check-in automatically.',
      'All cards are drag-to-reorder, saved per device.',
    ],
  },
  {
    id: 'v2.235',
    title: 'Live cardio',
    items: [
      'Time your cardio as you go. Tap CARDIO on the home screen, choose Start live, and a stopwatch counts your session up — no need to remember the minutes afterwards.',
      'Lock your phone, switch apps, keep moving. The timer keeps running in the background and even survives an app restart, so your time is never lost.',
      'A guided finish. When you\'re done you get a quick Well done, then you fill in the details one step at a time — type, distance, pace and effort — instead of one big form.',
      'Prefer the old way? Log manually is still right there for entering a session by hand.',
    ],
  },
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
