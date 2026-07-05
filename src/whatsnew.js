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
    id: 'v2.484',
    title: 'Whole Days, Any Plan',
    items: [
      "📅 Weekday plans can now import a whole day — not just its exercises. Pull your leg day (history and all) from another plan or a template, tap which weekday it lands on, done. Cycle plans could already do this; weekdays finally caught up.",
      "🔁 Importing a day across plans now actually sticks. Before, it'd pull the exercises in and then quietly drop them the second you hit Save. Fixed — what you import is what you keep.",
      "🎯 Your rep target now rides along in training. Single, range, or per-set — it shows right under the exercise name the whole time, so you always know what you're chasing, even once Smart Progression starts bumping the weight.",
      "🛟 A few things under the hood so nothing slips through the cracks: support messages can't silently fail to send anymore, and your logged sets are a bit safer when you train across multiple devices.",
    ],
  },
  {
    id: 'v2.482',
    title: 'Reps, Your Rules',
    items: [
      "🎯 New Range mode for reps — set a target like 8–12 instead of one fixed number, right next to Uniform and Per Set in the plan editor. It's now the default for freshly added exercises, since most lifts are trained across a window, not one exact count.",
      "➕ Adding exercises to a plan is faster now — pick one or several, and you're taken straight into sets/reps for each one, one after another. No more hunting down freshly-added rows to configure afterward.",
      "🎚️ Smart Progression just got personal — every exercise (Range included) can now override the global setting: dial in your own \"add weight after +N reps\" threshold, or switch it off entirely for exercises where auto weight bumps just get in the way (looking at you, lateral raises). A small icon in the plan list shows at a glance which exercises have a custom setting.",
      "📝 Exercise notes (\"cable pos 4, slow eccentric…\") are now fillable right when you create or edit an exercise — no more hunting for a separate note screen — and they still show up every time you train that exercise, in any plan.",
    ],
  },
  {
    id: 'v2.479',
    title: 'Mesocycles: Hell Mode',
    items: [
      "🎚️ Your mesocycle's RIR taper is now yours to set — choose where week 1 starts (0–3 RIR) and where the final week peaks. Find it in the plan editor's Mesocycle section.",
      "🔥 Or take it clean past failure: set a negative peak RIR and every working set auto-gets that many lengthened partials (−3 RIR = three partials past failure — and yes, they stack on top of your drop sets and myo-reps too). The RIR watermark literally catches fire the deeper you go. For the certifiably advanced only.",
      "🩹 Meso reliability, quietly fixed: earned weight jumps no longer keep climbing after a rough session, and a sick day or vacation now pauses your mesocycle instead of fast-forwarding it — you pick up exactly where you left off.",
    ],
  },
  {
    id: 'v2.474',
    title: 'Nothing Left Behind',
    items: [
      "🎯 Drop Set, Myo-Reps, Myo-Rep Match, and AMRAP Variations now open in their own clean panel instead of squeezing into the set list — the weight/rep row and your Finish/Add buttons stay put no matter how far you've scrolled or how many drops you've stacked up. It also now sits cleanly above the number pad instead of overlapping it.",
      "🛡️ Tap away or hit Cancel mid-chain with unsaved reps (or hit Home) — the app asks first now instead of silently tossing your progress.",
      "🔄 Fixed several bugs where tapping \"Update\" could still leave you stuck on the old version — updates now land cleanly every time.",
      "🖼️ Coaching chat / support tickets: tap any photo to view it full-screen, and paste an image straight from your clipboard instead of only picking a file.",
      "👇 Home now shows a small chevron hinting that Quick Actions live behind a pull-down — it was invisible until you actually started pulling, so a lot of people never found the feature. Tap it directly to open Quick Actions, or just pull down as before.",
    ],
  },
  {
    id: 'v2.460',
    title: 'Sweating the Small Stuff',
    items: [
      "🎯 Fixed: reordering fields inside a check-in category (Coaching → Customize Check-in) used to lift the row, look convincing, then quietly put it right back where it started. Every single time. It actually reorders now.",
      "✏️ AMRAP Variations' round-name field used to be indistinguishable from plain text, so approximately nobody knew it was editable. It's a proper box now, with an accent underline when you tap in — go rename \"Cable Row A\" to whatever you actually did.",
      "🌗 One settings sheet forgot to dim the screen behind it when it opened. A tiny thing, but it was bugging us more than it should have.",
    ],
  },
  {
    id: 'v2.458',
    title: 'AMRAP Variations',
    items: [
      "🔀 New intensity technique: AMRAP Variations. Turn any working set into back-to-back AMRAP rounds — same weight, no rest between them, chase reps until you can't anymore. Switching grip or variation each round is entirely optional: the label starts pre-filled with your current exercise, so you only touch it if you actually change something up. Find it under INTENSITY on any set.",
      "⚖️ Mesocycle auto-progression got fairer: when an exercise earns an extra set, that growth used to always land on your main lift only. Now it's distributed across every exercise hitting that muscle group that day, so gains don't keep stacking on the same lift.",
      "🛠 Fixed: leaving mid-set on a Drop Set, Myo-Rep, Lengthened Partial, or AMRAP Variations (e.g. jumping back to Home) used to wipe your progress. It's exactly where you left it when you come back.",
    ],
  },
  {
    id: 'v2.457',
    title: 'Compare Sessions, Sharper',
    items: [
      "📊 Compare Sessions — the set-by-set, side-by-side view against a past session of the same workout day — is now one tap away right after you finish too, not just from your history. Look for the button right under the volume delta on the Well Done screen.",
      '🎯 Fixed the default match it picks: it now always lines you up against your most recent earlier session, never one you haven’t even gotten to yet.',
      '📐 Rows using an intensity technique (Partials, Drop Sets, Myo Reps…) no longer shove the compared value to the top — it sits centered now, however tall the row gets.',
    ],
  },
  {
    id: 'v2.455',
    title: 'Second Thoughts, Officially Allowed',
    items: [
      "✏️ Mesocycle check-ins (Soreness, Joint, Pump & Volume) are no longer one-tap-and-it's-final — pick an answer, then confirm it, and revisit anything from a new 'Session feedback' button in the training footer, sorted by muscle group with Joint feedback and General feedback split apart. Change your mind as often as you like — nothing's sent anywhere until you finish the workout.",
      "🔄 Pull down on Home to open Quick Actions — there's a Reload App button in there now, for those \"why isn't this updating\" moments. Clears the cache and refetches everything, no digging through Settings required.",
      '🛠 Fixed a crash that could hit the plan viewer under certain conditions, and toggling Flexible mode on/off while editing a plan no longer resets your spot in the cycle.',
      '🎯 A lighter session on a different day type could wrongly trigger a NEW BEST celebration — fixed. Typing a warmup weight on the number pad could also silently overwrite your working sets; fixed that too.',
      '💾 Backups and restores got a reliability pass: exports/restores now cover your full history (cardio goals, glucose log, mesocycle state, sick/vacation/deload periods), and restoring a backup no longer quietly turns off your workout push notifications.',
      '🩺 Fixed a rare Health tab freeze that could happen with certain rest-day macro targets.',
    ],
  },
  {
    id: 'v2.450',
    title: 'We Wrote The Manual',
    items: [
      "🧭 Four new guided tours — Quick Actions, Cardio Plans, Deload/Sick/Vacation, and Customize — walk you through features you might've never noticed. Find them all in Settings → How to…",
      '💪 The Workout tour now covers Drop Sets, Myo-Reps, Lengthened Partials, Supersets/Giant Sets, and the mesocycle check-ins that pop up mid-session — plus how to save a freestyle session as a reusable template.',
      '📋 The plan-creation tour grew up too: the exercise library (search/filter/batch-edit), Flex plans, Mesocycle setup, plan versioning, and Backups are all explained now.',
    ],
  },
  {
    id: 'v2.445',
    title: 'Bug Hunt',
    items: [
      '🔗 Supersets and Giant Sets got a full reliability pass — a cardio exercise in a group now correctly hands off to its training partner, "Check All" respects the group too, and dragging exercises around the chip strip can no longer accidentally split a pair apart.',
      '🎯 Fixed several cases where a skipped set threw off progression targets and PR detection — whether you hit your numbers is now judged correctly no matter which set got skipped.',
      '👀 Drop Sets, Myo-Reps and Lengthened Partials now actually show up in the coaching dashboard and spectator view — previously invisible there, even though you did the work.',
      '🛠 Fixed two crashes: one when switching plans, one when opening an exercise\'s history if its set count differed between sessions.',
      '🔔 Push notifications for very long rest timers now line up with what\'s on screen instead of risking an early ping.',
    ],
  },
  {
    id: 'v2.444',
    title: 'Supersets, Unchained',
    items: [
      '🔗 Superset or Giant Set any exercise mid-workout — no pre-planning required. Tap INTENSITY on an exercise\'s first set and choose Superset to pair it with another exercise in your session, or a new one. Already paired up? The same button becomes Giant Set, adding a third exercise to the rotation.',
      '🩹 Cleaned up superset navigation: checking off a set could send you (or the keyboard) to the wrong exercise, and Drop Sets or Myo-Reps inside a superset ignored your training partner entirely. Finishing a set now reliably takes you to the right place.',
      '⌨️ Lengthened Partials now has its own FINISH button instead of the regular checkbox, so a set only counts once you\'ve confirmed your partials.',
      '🐛 Unchecking a completed Drop Set, Myo-Rep or Lengthened Partial left old data behind. Unchecking now clears it properly.',
      '📱 The exercise strip at the top of the training screen could leave the last exercise half off-screen. It now scrolls fully into view.',
      '🔄 Mesocycle progress (set adjustments, weight boosts, week counter) now syncs reliably across devices, and a crash when starting Meso 2 is fixed.',
    ],
  },
  {
    id: 'v2.439',
    title: 'Mesocycles',
    items: [
      'Turn any plan into a mesocycle (4–8 weeks). Target RIR counts down from 3 → 0 as the block progresses — the big glowing number in the training hero is your weekly cue, so you always know exactly how hard to push.',
      'After each exercise, a quick check-in on soreness, joints, pump and volume lets the app auto-tune your set count week over week. Hit all your planned reps with positive feedback? You earn a weight boost for next session — stacks on top of Smart Progression, which keeps doing its job in the background.',
      'When the meso wraps up, you\'re offered a deload (50% loads handled automatically), then Meso 2. Set counts reset to baseline so week 1 stays sane — your earned weight boosts compound forward across blocks.',
      'Your meso state — week counter, set deltas, weight boosts, everything — syncs to your account and picks up seamlessly on any device.',
    ],
  },
  {
    id: 'v2.438',
    title: 'Freestyle, for Humans',
    items: [
      'The finish screen now has a big "Add another exercise" button — so adding exercises to a freestyle workout is impossible to miss. If you ever wondered how to squeeze in one more movement, wonder no more.',
      'The button also changes personality based on how long you\'ve been training. Under 20 minutes? It glows and begs you to stay. 20–45 minutes? A gentle nudge. Over 45 minutes? It respects your life choices.',
      'A time-based message in the finish dialog sets the scene — anywhere from "the barbell\'s barely warm" to "now THAT\'s a workout." Honest feedback, no hurt feelings.',
    ],
  },
  {
    id: 'v2.437',
    title: 'Lengthened Partials',
    items: [
      'New intensity technique: finish your full reps, then keep pumping out partials at the bottom of the movement — the stretched position where the muscle is under the most tension. Your muscle fibres will hate you. In a good way.',
      'Tap INTENSITY during any exercise and choose Lengthened Partials. After you check off the set, a stepper appears so you can log how many partials you got.',
      'Partials show up in your session summary and history — so you always know exactly how much extra work went into a set.',
      'Various bug fixes and improvements.',
    ],
  },
  {
    id: 'v2.422',
    title: '⚡ Drop Sets, Myo-Reps & Myo-Rep Match',
    items: [
      '⚡ Intensity techniques are here. Tap the glowing INTENSITY button under any exercise during training to unlock three new ways to train past failure — no extra logging, no workarounds, just tap and go.',
      'Drop Set: strip the weight and keep pushing without ending the set. Log the full drop chain (e.g. 100kg×8 → 80kg×6 → 60kg×5) in one go. Every drop shows in your session summary.',
      'Myo-Reps: essentially rest-pause — one activation set, then a series of short-rest mini sets while the muscle is still loaded. Time-efficient and brutal in the best way.',
      'Myo-Rep Match: targets the exact total rep count from your preceding Myo-Rep set. A live progress bar fills and glows with every mini set — keep going until you match it. Go past failure, with precision.',
      'Several bug fixes and improvements.',
    ],
  },
  {
    id: 'v2.421',
    title: 'Fewer Taps, No Nasty Surprises',
    items: [
      '🏋️ Multi-add exercises to a plan day: select several at once and drop them all in with a single tap. No more opening the picker ten times for ten exercises.',
      '🛡️ Five sheets now protect your unsaved work — the day editor, session history edit, cardio log, exercise note, and macro targets all ask "Discard changes?" before eating your input. Accidental swipe-downs are no longer a tragedy.',
      '✏️ The rep count badge in the plan editor now sports a pencil icon — because tapping it opens full set/rep configuration, including per-set reps. The secret is out.',
    ],
  },
  {
    id: 'v2.419',
    title: 'Mixed Units — finally',
    items: [
      '🇬🇧 For everyone who lifts in kg but runs in miles: there\'s now a "Mixed" option in your unit settings. kg for iron, miles for cardio. Civilised.',
      'Find it under Settings → Appearance → Unit preference.',
    ],
  },
  {
    id: 'v2.418',
    title: 'Bug Fix + Plan Backups',
    items: [
      '🐛 Critical bug fixed: deleting any exercise from your library was silently wiping all training days from every plan. It didn\'t matter if the exercise was used in a plan or not — gone. This is now fixed.',
      '🗄️ Your plans are now backed up automatically. Every time you save changes to your training days, a snapshot is stored. Up to 10 backups per plan, always on hand.',
      'To restore: open a plan → Backups button → pick a snapshot → Restore. Done.',
    ],
  },
  {
    id: 'v2.416',
    title: 'Smarter Plan Versioning',
    items: [
      'Renaming a training day now also triggers the "apply from date" question — not just adding or removing days. Changed Push to Chest? The app asks from when, so the history of each day stays where it belongs.',
      'When switching to a new plan version, you can now choose which day to start on — not just Day 1. Starting a new plan tomorrow but you\'re mid-rotation? Pick Day 4, and the schedule continues exactly where your week is.',
      'Rest days are included in the start-day picker, so any position in the cycle is fair game.',
      '"From the beginning" is gone from the versioning sheet. Nobody actually uses retroactive plan rewrites — it only confused things.',
    ],
  },
  {
    id: 'v2.415',
    title: 'Your Flex Plan, Your Rules',
    items: [
      'The weekly session goal on flex plans is now optional — toggle it on for consistency tracking, or leave it off and just train when life allows. No target, no guilt.',
      'The 7-session-per-week limit is gone. Set whatever your schedule demands — the stepper may have opinions.',
      'Fixed: switching a flex plan back to a regular cycle plan no longer leaves a stale ×/week badge behind.',
    ],
  },
  {
    id: 'v2.414',
    title: 'Light Mode Polish',
    items: [
      'Cards, surfaces and borders are now properly visible in light mode — all the subtle cream tints have been replaced with theme-aware ink tints.',
      'The NEW BEST, IMPROVEMENT and regression overlays now match your active theme instead of always going full black.',
      'Success greens and skipped-day chips have better contrast on the light background.',
    ],
  },
  {
    id: 'v2.412',
    title: 'Deload week, templates & more',
    items: [
      'Deload week is here — start one from the Plans tab (or wait for the app to nudge you). Weights pre-fill at 50% of your last session automatically. One full cycle or week later the deload ends by itself and training picks up exactly where it left off.',
      'After every 8 completed cycles (or 8 weeks for weekday plans, or 8×frequency sessions for flex plans), the app congratulates you right when you finish your last training day of that block and asks if you want a deload. Say "not now" and it resets the counter for another 8.',
      'Workout templates: finish a freestyle session and save it as a template — then start future sessions from it, or drop it straight into any plan day. Find them in the Library under a new Templates tab.',
      'Exercise videos: paste a YouTube link onto any exercise. A play button shows up in the exercise editor, the detail view, and right in the training screen when you\'re about to do that exercise.',
      'Images in coaching chat — coaches and clients can both send photos in any thread. Tap the attachment icon, pick a photo, done. Thumbnails show inline in the conversation.',
      'Light theme contrast improvements, knurl textures now visible in library screenshots, and several smaller fixes across the app.',
    ],
  },
  {
    id: 'v2.406',
    title: 'Blood Glucose Tracking',
    items: [
      'Log blood glucose readings any time of day — straight from the daily log sheet. Add as many readings as you want, pick the context (fasted, fed, or other), and attach a note if something was off.',
      'A scatter chart on the Health tab shows your readings over time, with reference bands for the normal fasting range (3.9–5.6 mmol/L) and the postprandial limit (< 7.8 mmol/L). Dots are colour-coded by context so patterns jump out.',
      'Prefer mg/dL? Flip the unit in Health settings — values are always stored in mmol/L and converted on the fly, so you can switch back anytime without losing anything.',
      'Coaches see their clients\' glucose data on the Daily tab too.',
    ],
  },
  {
    id: 'v2.405',
    title: 'Training settings & a rest timer fix',
    items: [
      'Training settings are now organised into three sub-sections — Session, Weights & Progression, and Notifications. Easier to find things, less scrolling.',
      'New toggle under Session: turn off the regression indicator if seeing "you did worse" mid-workout isn\'t your thing. It\'s off, it never happened. 🙈',
      'Fixed: the rest timer used to jump to the wrong value when switching exercises mid-rest (after a cache reload). It now correctly holds whatever countdown it started with.',
      'Minor: the app no longer does unnecessary background refreshes when you switch back to it during a session — slightly snappier return.',
    ],
  },
  {
    id: 'v2.404',
    title: 'Push done right + visual polish',
    items: [
      'Push notifications are now properly verified before going live — enter the 6-digit code from the notification and the toggle flips on. A countdown bar shows the remaining 2 minutes; it turns orange under 30 seconds.',
      'No code entered in time? The slider goes back to off and the subscription is cancelled — no more half-enabled state sitting in the background.',
      'Cleaned up a bunch of visual inconsistencies across the app: border radii, accent colours, and weight unit labels are now consistent throughout.',
    ],
  },
  {
    id: 'v2.401',
    title: 'Smoother taps',
    items: [
      'Building an exercise is way less fiddly: muscle groups and equipment are now tap-anywhere chips instead of a dropdown — no more chasing a button that hides a few pixels above your finger (looking at you, iOS 👀).',
      'Logging on two devices? Your phone and tablet finally play nice — health entries for the same day sync without stepping on each other.',
      'Plus a handful of Health-tab tidy-ups: cleaner net-carb math, sick-mode tracking that actually sticks, and no more accidentally landing on a future day you can\'t save.',
    ],
  },
  {
    id: 'v2.400',
    title: 'Fresh paint & a tidy-up',
    items: [
      'Bottom nav bar got a glow-up: the active tab is now a bold, gold-filled key instead of a thin outline — same job, a lot more presence.',
      'Cardio plans, your way: pick one target for every day or a different one per day. Cleaner layout, your speed now shows right next to your pace, and the goal builder politely refuses half-filled forms.',
      'Your notification center can finally breathe — Zane clears out its own old pings when you reopen the app, instead of letting them stack up like dishes in the sink.',
      'Trained while under the weather? If Sick mode is on and you log a session, Zane gently asks "feeling better?" — so nobody accidentally stays "sick" for a month. 🤧',
      'Sharing a workout? Your screenshots no longer behead the Zane avatar (or your VIP background) — the divider line now stops just shy of his head instead of slicing clean through. 🗿',
    ],
  },
  {
    id: 'v2.395',
    title: 'Cardio Plans',
    items: [
      'Set a running, cycling or any cardio goal — target distance, due date, days per week — and the app builds a week-by-week progression that gets you there. Load increases gradually with a built-in recovery week every four weeks.',
      'Prefer full control? Manual mode lets you set the exact target for each training day yourself, activity by activity.',
      'Your plan target pre-fills automatically when you log a cardio session on a scheduled day — adjust the distance or duration if needed, then save.',
      'Find Cardio Plans under the Plan tab → Plans. Tap any active plan to see this week\'s target and the full progression ahead.',
    ],
  },
  {
    id: 'v2.394',
    title: 'Flexible session replacement',
    items: [
      'When you finish a session that wasn\'t on the plan, you now choose what happens to your cycle: continue from the day you just trained, keep the original cycle on track, or log it as a bonus without advancing',
      'Useful when you swap days — e.g. doing Push instead of Legs. Pick "continue from Push" and the app rotates the plan so Pull comes up next, with no gaps or false missed-day warnings',
      'Works in both regular cycle and flex mode',
      'Duplicating a plan now always starts fresh — version history stays with the original',
      'Several improvements to the check-in flow: export check-in data as formatted text or PDF, performance rating pre-filled from your health log, and more',
    ],
  },
  {
    id: 'v2.393',
    title: 'Under the hood',
    items: [
      'Push notification when a support message arrives, in both directions',
      'New message banner on the home screen takes you straight to the conversation',
      'Ticket status changes and deletions sync instantly across devices',
      'Resolved tickets automatically move to an archive section after 7 days',
      'Fixed some bugs to make room for new ones',
    ],
  },
  {
    id: 'v2.390',
    title: 'Flexible Plans',
    items: [
      'Cycle plans can now be flexible — no fixed weekdays and no rest days. The rotation only moves forward when you actually train, so a missed day never pushes your plan out of sync. Great for an unpredictable week: Sun–Tue–Thu one week, Mon–Wed–Sat the next.',
      'To set one up: Plan → create or edit a plan → keep Mode on "Cycle" → turn on "Flexible schedule", pick your weekly goal, add your days, and activate.',
      'On the home screen the day strip shows your rotation — look ahead, skip to the next workout, or catch up a day you missed.',
      'Coaching: the weekly goal you set drives your adherence in the dashboard, so it reflects how often you trained — not which days.',
    ],
  },
  {
    id: 'v2.382',
    title: 'Quick Actions & Bonus Workouts',
    items: [
      'New Quick Actions menu — pull down on the home screen to log a workout, daily data, cardio, a check-in, or message your coach without navigating anywhere.',
      'Start any day from your plan as a bonus session — pick "Workout → From plan", choose a day, and it\'s logged without touching your cycle. Useful when the equipment you need is taken.',
      'Freestyle workouts: open session, no plan needed. Add exercises as you go, name it at the end.',
      'The app figures out whether a bonus or freestyle session should advance your cycle: if today has training planned and you haven\'t done it yet, it asks. Already trained today or it\'s a rest day — automatically logged as bonus, no questions asked.',
    ],
  },
  {
    id: 'v2.381',
    title: 'Support Center',
    items: [
      'Report questions, bugs, or feature requests directly from the app — Settings → Support Center.',
      'Keep multiple tickets open at once, each with its own thread and category.',
      'See live whether your ticket is open, in progress, or resolved.',
      'Replies land right in the thread — a dot badge lets you know when something new arrived.',
    ],
  },
  {
    id: 'v2.380',
    title: 'Account — Change Password & Email, Training Reminder',
    items: [
      'You can now change your password and email address directly in the app — Settings → Account → Change password / Change email. No need to go through a sign-out flow.',
      'Training Reminder is now under Settings → Training (not Account). It sends you a push notification on days you have a workout scheduled — a quiet nudge so you don\'t miss a session.',
      'If push notifications aren\'t active yet, the reminder toggle takes you straight to the push setup so you can enable both in one go.',
    ],
  },
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
