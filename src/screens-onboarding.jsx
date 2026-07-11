/* Onboarding — welcome prompt & guided spotlight tour */

const { useState: useStateOB, useEffect: useEffectOB, useRef: useRefOB } = React;

// ─── Tour data registry ──────────────────────────────────────────────
// Each step: { route?, target?, title, body, visual?, placement? }
// route    — navigate to this route before showing the step (optional)
// target   — data-tour="..." attribute on the DOM element to spotlight (optional)
// visual   — key into TOUR_VISUALS for an inline illustration (optional)
// placement— 'top' | 'bottom' | auto (default)
window.TOURS = {
  createPlan: [
    {
      target: null,
      title: 'Welcome to ZANE',
      body: "Let's take a quick look around — two minutes and you'll know how to build your first training plan.",
    },
    {
      route: 'home',
      target: 'tab-plan',
      title: 'The Plan tab',
      body: 'Your training hub. Plans, training days, exercises, and your exercise library — all in one place.',
      placement: 'top',
    },
    {
      route: 'plan',
      target: 'plan-new-btn',
      title: 'Create a plan',
      body: 'A plan is a collection of training days. Each day gets its own exercises. Tap + to get started.',
      placement: 'bottom',
    },
    {
      target: null,
      title: 'A guided setup',
      body: 'Tap + and a quick walkthrough builds your plan with you: name it, pick how it moves (Cycle, Weekdays, or Flexible), choose a training split, and optionally run it as a mesocycle. It lays out the days, then you fill in the exercises.',
    },
    {
      target: null,
      title: 'Add training days',
      body: 'After creating your plan, use "+ Day" to add training days. Name each one — PUSH, PULL, UPPER, or A / B / C.',
      visual: 'days',
    },
    {
      target: null,
      title: 'Fill each day with exercises',
      body: 'Tap a day to open it, then add exercises. Search your exercise library, create a new one, or pick from recents. Set planned sets and reps for each.',
      visual: 'exercises',
    },
    {
      target: null,
      title: 'The Exercise Library',
      body: "Every exercise lives here — search, filter by muscle, equipment or rest size, and a Recent tab for what you've logged lately. Tap Select to multi-select a batch: bulk-edit them one after another, or delete several at once. Each exercise has muscle group, size, equipment, movement type and rep-target fields, plus an optional YouTube link that shows as a form-check button during training.",
      visual: 'planLibrary',
    },
    {
      target: null,
      title: 'Drag to reorder',
      body: 'Long-press any day or exercise to drag it into a new position. Reorder your plan structure at any time.',
      visual: 'drag',
    },
    {
      target: null,
      title: 'Workout Templates',
      body: 'Finish a freestyle session and you can save it as a template — every exercise and rep scheme included. Reuse it later from Quick Actions → Workout → Freestyle → From template, or pull it straight into a plan day: open the day\'s import picker and switch to the Templates tab.',
      visual: 'planTemplates',
    },
    {
      target: null,
      title: 'Flexible & Mesocycle Plans',
      body: 'In a plan\'s Options, "Flexible schedule" drops fixed days entirely — your next workout just waits until you log it, with an optional weekly-sessions goal for adherence tracking. "Mesocycle" turns on a 4–8 week block with RIR targets and the in-session check-ins from the workout tour — auto-regulating your sets as the block progresses.',
      visual: 'planFlexMeso',
    },
    {
      target: null,
      title: 'Plan Versioning',
      body: 'Changing your split later? Schedule the new day layout to take effect from a future date instead of overwriting today\'s plan. The ‹› browser in the plan viewer steps through every past and scheduled version, each tagged ACTIVE, SCHEDULED, or PAST.',
      visual: 'planVersions',
    },
    {
      target: null,
      title: 'Plan Backups',
      body: 'Every time your training days change, a snapshot is saved automatically. Tap Backups in the plan viewer to preview or restore an older day layout — pick the date it should take effect from, done.',
      visual: 'planBackups',
    },
    {
      route: 'home',
      target: 'tab-hist',
      title: 'Your training history',
      body: 'Every session is automatically logged here — sets, reps, volume, and personal records over time.',
      placement: 'top',
    },
    {
      target: null,
      title: "You're all set!",
      body: 'Head to the Plan tab and create your first training plan. You can always come back to this tour in Settings → How to…',
    },
  ],
};

window.TOURS.doWorkout = [
  {
    target: null,
    title: 'Workout Tour',
    body: "Let's walk through a complete training session — from the first warmup set to the well-done screen.",
  },
  {
    target: null,
    title: 'Warmup Sets',
    body: "When you start, a warmup modal slides up first. It shows each warmup set one at a time with the target weight and reps. Tap 'Check warmup set' to log it, or 'Skip' to jump straight to your working sets.",
    visual: 'trainWarmup',
  },
  {
    target: null,
    title: 'The Training Screen',
    body: 'After the warmup you land here. Exercise chips run across the top — tap any to jump to it. Below is the exercise card with your set rows: set number, last-time reference, weight, reps, done button, and a − to remove that set.',
    visual: 'trainOverview',
  },
  {
    target: null,
    title: 'Logging a Set',
    body: 'Tap a set row to activate it — the weight field gets a highlighted underline in your accent color. Enter weight, tap the reps field, enter reps. The keyboard auto-advances between fields and can confirm the set in one tap.',
    visual: 'trainLogSet',
  },
  {
    target: null,
    title: 'The Quick Keyboard',
    body: 'The custom numpad sits at the bottom. ↓ / ↑ step the weight up or down by your equipment increment. The dumbbell icon opens the plate calculator. The tall accent-colored button confirms the set.',
    visual: 'trainKeyboard',
  },
  {
    target: null,
    title: 'Plate Calculator',
    body: 'Opens from the dumbbell key on the keyboard. Shows which plates to load on each side of the bar as colored circles — calculated from your available equipment.',
    visual: 'trainPlates',
  },
  {
    target: null,
    title: 'Add & Remove Sets',
    body: 'The + button below the sets adds a new set (duplicating the last one). Each set row has a − button on the right — tap it to remove that set.',
    visual: 'trainSets',
  },
  {
    target: null,
    title: 'Intensity Techniques',
    body: "Tap INTENSITY above the sets to go beyond a plain working set. Drop Set descends the weight and keeps the reps coming. Lengthened Partials adds partial reps in the stretch after your full reps. Myo Rep (and Myo Match, once you've done one) chains activation sets with mini bursts to failure. You can also pair two exercises into a Superset — or three into a Giant Set — with no rest between them.",
    visual: 'trainIntensity',
  },
  {
    target: null,
    title: 'Exercise Notes',
    body: 'The Note button sits to the right of the + button, below the sets. Tap it to add a session note or a permanent exercise note — cues, tempo, substitutions. The note is shown every time you train that exercise.',
    visual: 'trainNotes',
  },
  {
    target: null,
    title: 'Navigate Exercises',
    body: 'The exercise chips at the top of the screen are your navigation. Tap any chip to jump to that exercise. Completed exercises show a small dot below their chip.',
    visual: 'trainNav',
  },
  {
    target: null,
    title: 'Skip Remaining Sets',
    body: "The footer bar at the bottom has a 'Skip remaining sets' button. Tap it to mark all incomplete sets of the current exercise as skipped and move on to the next.",
    visual: 'trainSkip',
  },
  {
    target: null,
    title: 'Mesocycle Check-ins',
    body: "Running a mesocycle (turn it on in a plan's Options)? A short check-in can pop up after a muscle group's sets — soreness carryover, joint discomfort, and how the pump and workload felt. Your honest answers quietly adjust next session's sets, and repeated joint pain or a weak pump on an exercise flags it as a swap candidate.",
    visual: 'trainMeso',
  },
  {
    target: null,
    title: 'Finish Your Workout',
    body: "Once you reach the last exercise, a 'Finish →' button appears in the footer. Tap it to end the session — you'll see a summary of sets, volume, and duration.",
    visual: 'trainEnd',
  },
  {
    target: null,
    title: 'Rate Your Session',
    body: 'Pick how the workout felt — Easy to Max Effort. This data powers your training load overview and helps identify fatigue patterns over time.',
    visual: 'trainFeel',
  },
  {
    target: null,
    title: 'Save as a Template',
    body: 'Finished a freestyle session? A "Save as template" button appears right on the well-done screen. Name it and every exercise, set and rep scheme is saved — start from it again later via Quick Actions → Workout → Freestyle → From template, or import it straight into a plan day.',
    visual: 'trainSaveTemplate',
  },
  {
    target: null,
    title: 'Workout Complete!',
    body: 'Your session is saved, PRs are flagged, and your progress is on record. Check the History tab any time to review past sessions.',
    visual: 'trainWellDone',
  },
];

window.TOURS.quickActions = [
  {
    target: null,
    title: 'Quick Actions',
    body: "One gesture, every shortcut. Swipe down anywhere on the Home screen to log today's data, start a workout, catch up on a missed day, log cardio, or message your coach — without digging through tabs.",
    visual: 'quickActionsSwipe',
  },
  {
    target: null,
    title: 'How to open it',
    body: 'From the Home screen, swipe down and let go once the label flips to RELEASE. The sheet slides up with every shortcut available to you right now.',
    visual: 'quickActionsSwipe',
  },
  {
    target: null,
    title: 'Daily Log',
    body: "Always there. Opens today's health entry straight away — body weight, macros, water and steps — no need to go through the Health tab first.",
    visual: 'quickActionsDailyLog',
  },
  {
    target: null,
    title: 'Workout',
    body: '"From plan" lets you pick any day from your schedule, not just today\'s — you decide at the end whether it replaces the scheduled day or just counts as a bonus session. "Freestyle" opens a blank session, or one seeded from a saved template.',
    visual: 'quickActionsWorkout',
  },
  {
    target: null,
    title: 'Backlog Session',
    body: "Shows up only when a day from your plan went unlogged. One tap logs it retroactively, dated back to when it should've happened — pick which one if there's more than one.",
    visual: 'quickActionsBacklog',
  },
  {
    target: null,
    title: 'Cardio',
    body: 'Always there. Start a live cardio timer or log a past session manually — running, cycling, rowing, whatever you tracked.',
    visual: 'quickActionsCardio',
  },
  {
    target: null,
    title: 'Check-in',
    body: "Shows up only while a weekly check-in is due — as a coaching client, self-coaching, or both. One tap drops you straight into the form.",
    visual: 'quickActionsCheckin',
  },
  {
    target: null,
    title: 'Message Coach',
    body: 'Shows up only while you have an active coach. Jumps straight into your private chat thread with them.',
    visual: 'quickActionsMessage',
  },
  {
    target: null,
    title: "You're all set!",
    body: 'Swipe down on Home any time you need to log something fast. Find this tour again in Settings → How to…',
  },
];

window.TOURS.healthTab = [
  {
    target: null,
    title: 'Health Tab Tour',
    body: "Let's walk through the Health tab — your daily log for weight, nutrition, steps, and cardio.",
  },
  {
    target: null,
    title: 'Enable the Health tab',
    body: 'The Health tab is hidden by default. Go to Settings → Health and toggle "Show Health tab" to pin it to the bottom navigation.',
    visual: 'healthEnable',
  },
  {
    route: 'home',
    target: 'tab-health',
    title: 'The Health tab',
    body: 'Once enabled, the Health tab appears in the bottom nav. Tap it to open your daily log and charts.',
    placement: 'top',
  },
  {
    route: 'health',
    target: 'health-log-btn',
    title: 'Log your day',
    body: 'Tap LOG to open the daily entry sheet. Record weight, steps, calories, macros, and water for any day.',
    placement: 'bottom',
  },
  {
    target: null,
    title: 'Daily Log Sheet',
    body: 'Fill in what you tracked today — body weight, step count, water intake, and your macros. Missed a day? Navigate to any past date and log it retroactively.',
    visual: 'healthLog',
  },
  {
    target: 'health-card-macros',
    title: 'Macros & Targets',
    body: 'Set your daily macro targets (protein / carbs / fat) and the app tracks your adherence automatically. Tap SET or EDIT in the Macros card to configure your goals.',
    placement: 'bottom',
  },
  {
    target: null,
    title: 'Cardio Logging',
    body: "Log cardio from the Home screen — tap the golden CARDIO button at the bottom. Start a live timer or log manually. The Health tab shows your cardio minutes as a chart. Want a structured plan that ramps toward a goal instead? See the Cardio Plans tour in Settings → How to…",
    visual: 'healthCardio',
  },
  {
    target: null,
    title: 'Week & Long-term View',
    body: 'The Week card at the top summarises the current period — training sessions done, macro adherence, and cardio minutes. Switch to 1M or 3M for a longer-range overview.',
    visual: 'healthWeek',
  },
  {
    target: null,
    title: "You're all set!",
    body: 'Start logging daily and let the charts fill in over time. Even partial data — just weight or steps — is useful. Find the Health tab again in the bottom nav.',
  },
];

window.TOURS.cardioPlans = [
  {
    target: null,
    title: 'Cardio Plans',
    body: "Beyond logging a session, you can build a structured cardio plan — fixed weekly targets, or a progressive plan that ramps you toward a goal by a due date. Create one from the Cardio tab.",
    visual: 'cardioIntro',
  },
  {
    target: null,
    title: 'Choose Your Activity',
    body: 'Pick from Running, Walking, Cycling, Swimming, Rowing, Elliptical, Hiking — or Custom for anything else you log. Then choose the plan type: Manual (fixed weekly targets you set) or Goal (the app builds a progression for you).',
    visual: 'cardioActivity',
  },
  {
    target: null,
    title: 'Manual Plan',
    body: 'Tap the days you train, then set targets — the same distance or duration every day, or different per day. Prefer to just show up with no numbers attached? Turn targets off entirely.',
    visual: 'cardioManual',
  },
  {
    target: null,
    title: 'Goal Plan',
    body: "Pick a goal type — Distance, Distance + Pace, or Duration — set your target and a due date, and the days you'll train. Then tell it your current fitness: how far or how long you can comfortably go right now.",
    visual: 'cardioGoal',
  },
  {
    target: null,
    title: 'Progressive Plan Preview',
    body: "The plan ramps session by session toward your goal — capped at a sustainable ~10% increase per week — with every 4th week a lighter recovery week. If the math shows you won't reach the goal by your due date, you'll get a warning to extend the timeline.",
    visual: 'cardioPreview',
  },
  {
    target: null,
    title: 'One Active Plan',
    body: "Only one plan is active at a time — it's the one shown on the Home screen widget and pre-fills your cardio logs. Activate or deactivate any plan from its detail sheet; a new plan auto-activates if nothing else is running.",
    visual: 'cardioActivate',
  },
  {
    target: null,
    title: "You're all set!",
    body: 'Build a plan and let it guide your pace and distance week by week. Find this tour again in Settings → How to…',
  },
];

window.TOURS.statusModes = [
  {
    target: null,
    title: 'Deload, Sick & Vacation',
    body: "Life doesn't always follow the plan. Three modes let the app know when you're taking it easier — without losing your progress or skewing your stats.",
    visual: 'statusIntro',
  },
  {
    target: null,
    title: 'Deload Week',
    body: '"Start deload week" sits on your active plan card. It trains your normal plan at ~50% load for one cycle — weights pre-fill light and a DELOAD · 50% badge shows during training. It excludes itself from progression, so the week after picks up right where you left off.',
    visual: 'statusDeload',
  },
  {
    target: null,
    title: 'The Deload Prompt',
    body: "Two things can offer you one. Finish the last week of a mesocycle and \"Mesocycle complete!\" pops up right on the session-end screen, offering a deload before Meso 2 starts. Independent of that, roughly every 8 training cycles without one, a general nudge asks if you're due a break. Accept either, or dismiss and keep training — you'll be asked again next time.",
    visual: 'statusNudge',
  },
  {
    target: null,
    title: 'Sick & Vacation',
    body: "For time off training entirely, mark it right on the day: Health tab → tap a day → Edit Day → the Sick / Normal / Vacation toggle up top. Unlike deload, these don't touch your weights — they just keep sick/vacation days out of your training-adherence score. Review or edit past periods any time in Settings → Health → Sick & Vacation periods.",
    visual: 'statusSickVacation',
  },
  {
    target: null,
    title: "You're all set!",
    body: 'Use these whenever training takes a back seat — your stats and progression stay honest either way. Find this tour again in Settings → How to…',
  },
];

window.TOURS.customize = [
  {
    target: null,
    title: 'Customize ZANE',
    body: "A quick pass through the settings worth knowing about — the ones that change how the app looks, and the ones that change how it trains you.",
    visual: 'customIntro',
  },
  {
    target: null,
    title: 'Appearance',
    body: 'Pick an accent color and a theme — Dark, OLED Black, or a light cream. Your unit preference (kg/lbs) lives here too — it only relabels displayed weights, your logged numbers never get converted.',
    visual: 'customAppearance',
  },
  {
    target: null,
    title: 'Rest Timers',
    body: 'Set default rest durations by exercise size — Big compounds, Medium, and Small isolation moves each get their own timer. Tag an exercise with a size in the library and the right rest applies automatically.',
    visual: 'customRest',
  },
  {
    target: null,
    title: 'Equipment & Plates',
    body: "Equipment setup defines the weight increment and max load per equipment type, so the app suggests sensible jumps. Plate inventory tells the plate calculator exactly which plates you own, so it never suggests one you don't have.",
    visual: 'customEquipment',
  },
  {
    target: null,
    title: 'Smart Progression',
    body: 'Turn this on and the app bumps your weight automatically once every set clears a rep threshold above target — e.g. target 8 reps, range top +4, weight goes up once all sets hit 12. Different from Mesocycle: this is the everyday auto-progression, Mesocycle is the structured multi-week block with RIR targets.',
    visual: 'customProgression',
  },
  {
    target: null,
    title: 'Paceguard',
    body: 'Want tempo control on your reps? Paceguard beeps out the eccentric (down) and concentric (up) phase of each rep at durations you set — useful for slowing down and controlling form.',
    visual: 'customPaceguard',
  },
  {
    target: null,
    title: "You're all set!",
    body: 'Small settings, real difference — worth a look once, then forget about them. Find this tour again in Settings → How to…',
  },
];

window.TOURS.coaching = [
  {
    target: null,
    title: 'Coaching Tour',
    body: "Coaching links a coach and a client inside the app — shared training data, weekly check-ins, macro targets, and a private message thread. Let's walk through both sides.",
  },
  {
    target: null,
    title: 'Enable the Coaching tab',
    body: 'The Coaching tab is hidden until you need it. Open Settings → Coaching and turn on "Coaching tab" to pin it to the bottom navigation. It also appears automatically the moment a coaching relationship goes active.',
    visual: 'coachEnable',
  },
  {
    target: null,
    title: 'Coach, client, or both',
    body: 'You can coach others, be coached, or both at once. When you hold more than one role the tab shows a switcher across them: My Clients, My Coach, and Myself.',
    visual: 'coachRoles',
  },
  {
    target: null,
    title: 'As a client: accept an invite',
    body: "When a coach invites you, this request pops up next time you open the app. Accept and your coach can see your training, sessions and plans — and adjust them for you. Decline and nothing is shared.",
    visual: 'coachInviteAccept',
  },
  {
    target: null,
    title: 'Your weekly check-in',
    body: "Each week you fill in a short check-in — body weight, recovery markers like sleep and hunger, and how training went. If you use the Health tab, your daily logs prefill most of it automatically.",
    visual: 'coachCheckin',
  },
  {
    target: null,
    title: 'Macros from your coach',
    body: 'Your coach can set daily macro targets — separate numbers for training and rest days. They appear in your Coaching tab and feed straight into the Health tab adherence tracking.',
    visual: 'coachMacros',
  },
  {
    target: null,
    title: 'Notes & messaging',
    body: 'Every coaching relationship has a private thread. Coach and client leave notes on sessions, plans, or just talk — questions, cues, weekly feedback. Unread notes ping you on the home screen.',
    visual: 'coachNotes',
  },
  {
    target: null,
    title: 'As a coach: invite a client',
    body: 'Open the Coaching tab and tap the add-person icon. Enter the email of someone who already has an account — they get the invite the next time they open the app.',
    visual: 'coachInvite',
  },
  {
    target: null,
    title: 'Your client dashboard',
    body: "Each client is a card. You see who's training live right now, who has a check-in due, and who just submitted one. Tap a card to open their full profile.",
    visual: 'coachClients',
  },
  {
    target: null,
    title: 'Review check-ins & trends',
    body: "Inside a client, their check-in history becomes trend charts — weight, recovery markers, performance week over week. Spot a bad sleep streak or a stalling weight at a glance.",
    visual: 'coachTrends',
  },
  {
    target: null,
    title: 'Customize the check-in form',
    body: "The check-in form isn't fixed. Per client you can add, remove, or reorder fields in the schema builder — drop in a custom scale, a number, or a note field for exactly what you want to track.",
    visual: 'coachSchema',
  },
  {
    target: null,
    title: 'Be your own coach',
    body: 'No coach? Flip on "Be your own coach" in Settings → Coaching. You get the whole coach dashboard — trends, macros, check-ins and notes — pointed at your own training. Great for self-guided periodization.',
    visual: 'coachSelf',
  },
  {
    target: null,
    title: "You're all set!",
    body: 'Coach others, get coached, or run it solo — all from one tab. Find this tour again any time in Settings → How to…',
  },
];

window.TOURS.installPwaIos = [
  {
    target: null,
    title: 'Install on iPhone — Step 1',
    body: 'Open Zane in Safari — the default iOS browser. Chrome and Firefox cannot install apps on iPhone.',
    visual: 'pwaIosSafari',
  },
  {
    target: null,
    title: 'Tap the Share button',
    body: 'Tap the Share button — the square with an arrow pointing up. Depending on your iOS version, it sits in the bottom toolbar or in a sub menu in the address bar area.',
    visual: 'pwaIosShare',
  },
  {
    target: null,
    title: 'Tap "Add to Home Screen"',
    body: 'Scroll through the share sheet and tap "Add to Home Screen". If you don\'t see it, scroll the bottom row of app icons.',
    visual: 'pwaIosAddToHome',
  },
  {
    target: null,
    title: 'Tap "Add"',
    body: 'Confirm the name and tap "Add" in the top-right corner. Zane appears on your home screen instantly — no App Store needed.',
    visual: 'pwaIosAdd',
  },
];

window.TOURS.installPwaAndroid = [
  {
    target: null,
    title: 'Install on Android — Step 1',
    body: 'Open Zane in Chrome — the default Android browser. Chrome gives the best installation experience.',
    visual: 'pwaAndroidChrome',
  },
  {
    target: null,
    title: 'Open the menu',
    body: 'Tap the three-dot menu in the top-right corner of Chrome.',
    visual: 'pwaAndroidMenu',
  },
  {
    target: null,
    title: 'Tap "Add to Home screen"',
    body: 'Find and tap "Add to Home screen" in the menu. On some Chrome versions it may say "Install app".',
    visual: 'pwaAndroidAddToHome',
  },
  {
    target: null,
    title: 'Tap "Install"',
    body: 'A dialog appears with the Zane icon and name. Tap "Install" — done. Zane opens like a native app from now on.',
    visual: 'pwaAndroidInstall',
  },
];

// ─── Inline visual mockups ───────────────────────────────────────────
function TourVisualDays() {
  const rowStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 10px', background: UI.bgInset,
    border: `1px solid ${UI.hairStrong}`, borderRadius: 4,
  };
  const label = { fontFamily: UI.fontUi, fontSize: 11, fontWeight: 600, color: UI.inkSoft, letterSpacing: '0.06em' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {['PUSH', 'PULL', 'LEGS'].map(name => (
        <div key={name} style={rowStyle}>
          <span style={label}>{name}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={UI.inkFaint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 2px' }}>
        <span style={{ color: 'var(--accent)', fontSize: 18, lineHeight: 1, fontWeight: 300 }}>+</span>
        <span style={{ fontFamily: UI.fontUi, fontSize: 11, color: 'var(--accent)', letterSpacing: '0.10em', fontWeight: 600 }}>ADD DAY</span>
      </div>
    </div>
  );
}

function TourVisualExercises() {
  const exercises = ['BENCH PRESS', 'INCLINE DUMBBELL', 'TRICEP PUSHDOWN'];
  return (
    <div style={{ background: UI.bgInset, border: `1px solid ${UI.hairStrong}`, borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ padding: '7px 10px', borderBottom: `1px solid ${UI.hairStrong}` }}>
        <span style={{ fontFamily: UI.fontUi, fontSize: 9, letterSpacing: '0.14em', color: UI.inkFaint }}>PUSH DAY</span>
      </div>
      {exercises.map((ex, i) => (
        <div key={ex} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: i < exercises.length - 1 ? `1px solid ${UI.hairStrong}` : 'none' }}>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft, fontWeight: 500 }}>{ex}</span>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px' }}>
        <span style={{ color: 'var(--accent)', fontSize: 16, lineHeight: 1, fontWeight: 300 }}>+</span>
        <span style={{ fontFamily: UI.fontUi, fontSize: 10, color: 'var(--accent)', letterSpacing: '0.10em', fontWeight: 600 }}>ADD EXERCISE</span>
      </div>
    </div>
  );
}

function TourVisualDrag() {
  const exercises = ['BENCH PRESS', 'INCLINE DUMBBELL', 'TRICEP PUSHDOWN'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {exercises.map((ex, i) => (
        <div key={ex} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px',
          background: i === 1 ? 'rgba(var(--accent-rgb),0.08)' : UI.bgInset,
          border: `1px solid ${i === 1 ? 'rgba(var(--accent-rgb),0.3)' : UI.hairStrong}`,
          borderRadius: 4, opacity: i === 1 ? 0.6 : 1,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2.5, padding: '0 2px', cursor: 'grab' }}>
            {[0,1,2].map(j => <div key={j} style={{ width: 14, height: 1.5, background: UI.inkGhost, borderRadius: 4 }} />)}
          </div>
          <span style={{ fontFamily: UI.fontUi, fontSize: 11, color: UI.inkSoft, fontWeight: 500 }}>{ex}</span>
          {i === 1 && <span style={{ marginLeft: 'auto', fontFamily: UI.fontUi, fontSize: 9, color: 'var(--accent)', letterSpacing: '0.08em' }}>DRAG</span>}
        </div>
      ))}
    </div>
  );
}

function TourVisualPlanLibrary() {
  const rows = [
    { name: 'BENCH PRESS', sub: 'Chest · Barbell' },
    { name: 'INCLINE DUMBBELL', sub: 'Chest · Dumbbell' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1, padding: '8px 10px', borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, fontSize: 11, fontFamily: UI.fontUi, color: UI.inkFaint }}>Search…</div>
        <div style={{ padding: '8px 10px', borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, fontSize: 10, fontFamily: UI.fontUi, color: UI.inkFaint, fontWeight: 700, letterSpacing: '0.06em' }}>FILTER</div>
        <div style={{ padding: '8px 10px', borderRadius: 4, background: `rgba(var(--accent-rgb),0.12)`, border: `0.5px solid rgba(var(--accent-rgb),0.4)`, fontSize: 10, fontFamily: UI.fontUi, color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.06em' }}>SELECT</div>
      </div>
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderBottom: i === 0 ? `0.5px solid ${UI.hair}` : 'none' }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, border: `1.5px solid rgba(var(--accent-rgb),0.5)`, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 11.5, fontFamily: UI.fontUi, fontWeight: 600, color: UI.ink }}>{r.name}</div>
              <div style={{ fontSize: 9.5, fontFamily: UI.fontUi, color: UI.inkFaint, marginTop: 1 }}>{r.sub}</div>
            </div>
            <i className="fa-brands fa-youtube" style={{ marginLeft: 'auto', fontSize: 12, color: UI.inkGhost }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function TourVisualPlanTemplates() {
  const tabs = ['Plans', 'Templates'];
  const templates = [{ name: 'Push A', sub: '5 exercises' }, { name: 'Pull A', sub: '6 exercises' }];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 3, background: UI.bgInset, borderRadius: 4, padding: 3 }}>
        {tabs.map((t, i) => (
          <div key={t} style={{ flex: 1, textAlign: 'center', padding: '6px 0', borderRadius: 4, background: i === 1 ? 'var(--accent)' : 'transparent', color: i === 1 ? '#0a0805' : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, fontWeight: i === 1 ? 600 : 400, letterSpacing: '0.06em' }}>{t}</div>
        ))}
      </div>
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
        {templates.map((t, i) => (
          <div key={t.name} style={{ display: 'flex', alignItems: 'center', padding: '9px 11px', borderBottom: i === 0 ? `0.5px solid ${UI.hair}` : 'none' }}>
            <i className="fa-solid fa-bookmark" style={{ fontSize: 11, color: 'var(--accent)', width: 18 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, fontFamily: UI.fontUi, fontWeight: 600, color: UI.ink }}>{t.name}</div>
              <div style={{ fontSize: 9.5, fontFamily: UI.fontUi, color: UI.inkFaint, marginTop: 1 }}>{t.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function tourToggleRow(label, sub, on) {
  return (
    <div style={{ background: UI.bgCard, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12.5, fontFamily: UI.fontUi, color: UI.ink, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 10, fontFamily: UI.fontUi, color: UI.inkFaint, marginTop: 2 }}>{sub}</div>
      </div>
      <div style={{ width: 40, height: 23, borderRadius: 13, background: on ? 'var(--accent)' : UI.bgInset, border: `0.5px solid ${on ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`, position: 'relative', flexShrink: 0 }}>
        <div style={{ position: 'absolute', top: 2.5, [on ? 'right' : 'left']: 2.5, width: 16, height: 16, borderRadius: '50%', background: on ? '#0a0805' : UI.inkFaint }} />
      </div>
    </div>
  );
}

function TourVisualPlanFlexMeso() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tourToggleRow('Flexible schedule', 'Advance only when I train', true)}
      {tourToggleRow('Mesocycle', '6-week mesocycle', true)}
    </div>
  );
}

function TourVisualPlanVersions() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: UI.bgCard, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '9px 12px' }}>
        <i className="fa-solid fa-chevron-left" style={{ fontSize: 10, color: UI.inkFaint }} />
        <div style={{ flex: 1, textAlign: 'center' }}>
          <span style={{ fontSize: 10, fontFamily: UI.fontUi, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.06em' }}>V3 · ACTIVE</span>
          <span style={{ fontSize: 10, fontFamily: UI.fontUi, color: UI.inkFaint, marginLeft: 6 }}>Dec 15</span>
        </div>
        <i className="fa-solid fa-chevron-right" style={{ fontSize: 10, color: UI.inkGhost }} />
      </div>
      <div style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi, textAlign: 'center' }}>swipe through past &amp; scheduled versions</div>
    </div>
  );
}

function TourVisualPlanBackups() {
  const backups = [
    { when: 'Today, 14:02', sub: '4 days' },
    { when: 'Jun 03, 09:41', sub: '3 days' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
        {backups.map((b, i) => (
          <div key={b.when} style={{ display: 'flex', alignItems: 'center', padding: '9px 11px', borderBottom: i === 0 ? `0.5px solid ${UI.hair}` : 'none' }}>
            <i className="fa-solid fa-clock-rotate-left" style={{ fontSize: 11, color: UI.inkFaint, width: 18 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11.5, fontFamily: UI.fontUi, color: UI.ink, fontWeight: 600 }}>{b.when}</div>
              <div style={{ fontSize: 9.5, fontFamily: UI.fontUi, color: UI.inkFaint, marginTop: 1 }}>{b.sub}</div>
            </div>
            <span style={{ fontSize: 9, fontFamily: UI.fontUi, color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.06em' }}>PREVIEW</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrainChips({ states }) {
  // states: 'active' | 'done' | 'pending'
  const labels = ['BENCH', 'INCLINE', 'TRICEP'];
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {labels.map((c, i) => {
        const st = states[i];
        return (
          <div key={c} style={{
            padding: '5px 11px 4px', borderRadius: 4,
            border: `1px solid ${st === 'active' ? 'var(--accent)' : st === 'done' ? UI.goldSoft : UI.hairStrong}`,
            background: st === 'active' ? `rgba(var(--accent-rgb),0.08)` : st === 'done' ? `rgba(var(--accent-rgb),0.05)` : 'transparent',
          }}>
            <div style={{ fontSize: 10, fontFamily: UI.fontUi, letterSpacing: '0.07em', color: st === 'active' ? 'var(--accent)' : st === 'done' ? UI.inkSoft : UI.inkFaint }}>{c}</div>
            <div style={{ height: 3, marginTop: 3, display: 'flex', justifyContent: 'center' }}>
              {st === 'done' && <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)' }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TourVisualTrainOverview() {
  const sets = [
    { label: '1', done: true },
    { label: '2', done: false, active: true },
    { label: '3', done: false },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <TrainChips states={['active', 'done', 'pending']} />
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
        <div style={{ padding: '7px 10px', borderBottom: `0.5px solid ${UI.hair}`, display: 'flex', alignItems: 'center' }}>
          <span style={{ fontFamily: UI.fontDisplay, fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: UI.ink, textTransform: 'uppercase', flex: 1 }}>Bench Press</span>
          <span style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkGhost }}>3 × 8</span>
        </div>
        {sets.map((s, i) => (
          <div key={s.label} style={{
            display: 'grid', gridTemplateColumns: '22px 1fr auto 28px 22px', alignItems: 'center', gap: 6, padding: '6px 10px',
            background: s.active ? `rgba(var(--accent-rgb),0.07)` : s.done ? `rgba(var(--accent-rgb),0.04)` : 'transparent',
            borderBottom: i < sets.length - 1 ? `0.5px solid ${UI.hair}` : 'none',
          }}>
            <div style={{ width: 20, height: 20, borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, color: UI.inkGhost }}>{s.label}</div>
            <div className="num" style={{ fontSize: 12, color: s.active ? 'var(--accent)' : UI.ink }}>{`80 ${UI.unit()}`}</div>
            <div className="num" style={{ fontSize: 12, color: s.active ? 'var(--accent)' : UI.inkSoft }}>8</div>
            <div style={{ width: 26, height: 26, borderRadius: 4, background: s.done ? 'var(--accent)' : s.active ? `rgba(var(--accent-rgb),0.12)` : UI.bgInset, border: `1.5px solid ${(s.done || s.active) ? 'var(--accent)' : UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: s.active ? `0 0 0 3px rgba(var(--accent-rgb),0.15)` : 'none' }}>
              {s.done && <i className="fa-solid fa-check" style={{ fontSize: 9, color: '#0a0805' }} />}
            </div>
            <div style={{ width: 20, height: 20, borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: UI.inkFaint, fontSize: 14, lineHeight: 1 }}>−</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TourVisualTrainWarmup() {
  return (
    <div style={{ background: UI.bgRaised, borderRadius: 8, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden', paddingBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10, paddingBottom: 8 }}>
        <div style={{ width: 32, height: 3, borderRadius: 4, background: UI.inkGhost }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px 12px', gap: 8 }}>
        <span style={{ fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--accent)' }}>WARMUP</span>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', opacity: 0.7 }} />
        <div style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 4, background: 'transparent', border: `0.5px solid ${UI.hairStrong}`, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 9, fontWeight: 700, letterSpacing: '0.07em' }}>SKIP</div>
      </div>
      <div style={{ textAlign: 'center', padding: '0 16px 14px' }}>
        <div className="num" style={{ fontSize: 36, color: UI.ink, fontWeight: 300 }}>{`40 ${UI.unit()}`}</div>
        <div className="num" style={{ fontSize: 15, color: UI.inkSoft, marginTop: 2 }}>× 10 reps</div>
      </div>
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{ padding: '12px', borderRadius: 6, textAlign: 'center', background: 'linear-gradient(160deg, var(--accent-light), var(--accent))', color: '#0a0805', fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>✓ CHECK WARMUP SET</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: i === 0 ? 'var(--accent)' : i === 1 ? `rgba(var(--accent-rgb),0.2)` : UI.bgInset, border: `1.5px solid ${i === 0 ? 'var(--accent)' : i === 1 ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {i === 0 && <i className="fa-solid fa-check" style={{ fontSize: 8, color: '#0a0805' }} />}
            </div>
            <span style={{ fontSize: 7, fontFamily: UI.fontUi, color: i === 0 ? 'var(--accent)' : UI.inkGhost, fontWeight: 700 }}>W{i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TourVisualTrainLogSet() {
  const sets = [
    { label: '1', done: true },
    { label: '2', done: false, active: true },
    { label: '3', done: false },
  ];
  return (
    <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
      <div style={{ padding: '7px 10px', borderBottom: `0.5px solid ${UI.hair}`, display: 'flex', alignItems: 'center' }}>
        <span style={{ fontFamily: UI.fontDisplay, fontSize: 13, fontWeight: 700, color: UI.ink, textTransform: 'uppercase', flex: 1 }}>Bench Press</span>
      </div>
      {sets.map((s, i) => (
        <div key={s.label} style={{
          display: 'grid', gridTemplateColumns: '22px 1fr auto 30px 22px', alignItems: 'center', gap: 6, padding: '7px 10px',
          background: s.active ? `rgba(var(--accent-rgb),0.08)` : s.done ? `rgba(var(--accent-rgb),0.04)` : 'transparent',
          borderBottom: i < sets.length - 1 ? `0.5px solid ${UI.hair}` : 'none',
        }}>
          <div style={{ width: 20, height: 20, borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, color: UI.inkGhost }}>{s.label}</div>
          <div className="num" style={{ fontSize: 13, color: s.active ? 'var(--accent)' : UI.ink }}>80.0</div>
          <div className="num" style={{ fontSize: 13, color: s.active ? 'var(--accent)' : UI.inkSoft }}>8</div>
          <div style={{ width: 28, height: 28, borderRadius: 4, background: s.done ? 'var(--accent)' : s.active ? `rgba(var(--accent-rgb),0.12)` : UI.bgInset, border: `1.5px solid ${(s.done || s.active) ? 'var(--accent)' : UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: s.active ? `0 0 0 3px rgba(var(--accent-rgb),0.15)` : 'none' }}>
            {s.done ? <i className="fa-solid fa-check" style={{ fontSize: 10, color: '#0a0805' }} /> : s.active ? <i className="fa-solid fa-check" style={{ fontSize: 10, color: 'var(--accent)' }} /> : null}
          </div>
          <div style={{ width: 20, height: 20, borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: UI.inkFaint, fontSize: 14, lineHeight: 1 }}>−</div>
        </div>
      ))}
      <div style={{ padding: '5px 10px 7px', display: 'flex', alignItems: 'center', gap: 5 }}>
        <i className="fa-solid fa-arrow-up" style={{ fontSize: 9, color: UI.inkGhost }} />
        <span style={{ fontSize: 10, fontFamily: UI.fontUi, color: UI.inkGhost }}>Tap the ✓ on the active row to confirm the set</span>
      </div>
    </div>
  );
}

function TourVisualTrainKeyboard() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', gap: 5, marginBottom: 2 }}>
        {[[UI.unit().toUpperCase(), '80.0', true], ['REPS', '8', false]].map(([lbl, val, active]) => (
          <div key={lbl} style={{
            flex: 1, textAlign: 'center', padding: '5px 4px',
            background: UI.bgCard, borderRadius: 4,
            border: `0.5px solid ${active ? 'rgba(var(--accent-rgb),0.5)' : UI.hairStrong}`,
            borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
          }}>
            <div style={{ fontSize: 8, color: UI.inkGhost, fontFamily: UI.fontUi, marginBottom: 1, letterSpacing: '0.06em' }}>{lbl}</div>
            <div className="num" style={{ fontSize: 17, color: active ? 'var(--accent)' : UI.inkSoft }}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) 50px', gridTemplateRows: 'repeat(5, 32px)', gap: 3 }}>
        {['↓', null, '↑'].map((k, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontNum }}>
            {k === null ? <i className="fa-solid fa-dumbbell" style={{ fontSize: 11, color: UI.inkSoft }} /> : k}
          </div>
        ))}
        {/* CONFIRM — tall accent button spanning rows 1–4, column 4 */}
        <div style={{ gridRow: '1 / 5', gridColumn: 4, background: 'var(--accent)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="fa-solid fa-check" style={{ fontSize: 15, color: '#0a0805' }} />
        </div>
        {/* Rows 2–4: 1 2 3 / 4 5 6 / 7 8 9 */}
        {['1','2','3','4','5','6','7','8','9'].map(n => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, fontFamily: UI.fontNum, fontSize: 14, color: UI.ink }}>{n}</div>
        ))}
        {/* Row 5: blank / 0 / ⌫ / ⌄ */}
        <div style={{ background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4 }} />
        {['0','⌫','⌄'].map(k => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4, fontFamily: UI.fontNum, fontSize: 13, color: k === '⌫' ? UI.inkSoft : UI.ink }}>{k}</div>
        ))}
      </div>
    </div>
  );
}

function TourVisualTrainPlates() {
  // Per side for 90 kg dual = 45 → 25×1 + 20×1 (greedy, like the real calc)
  const plates = [
    { kg: 25, n: 1, color: '#c0392b', size: 50 },
    { kg: 20, n: 1, color: '#2471a3', size: 46 },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 3, background: UI.bgInset, borderRadius: 4, padding: 3 }}>
        {['Dual side', 'Single'].map((t, i) => (
          <div key={t} style={{ flex: 1, textAlign: 'center', padding: '6px 0', borderRadius: 4, background: i === 0 ? 'var(--accent)' : 'transparent', color: i === 0 ? '#0a0805' : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, fontWeight: i === 0 ? 600 : 400, letterSpacing: '0.06em' }}>{t}</div>
        ))}
      </div>
      <div style={{ textAlign: 'center', position: 'relative' }}>
        <span className="num" style={{ fontSize: 40, color: UI.ink, fontWeight: 300, letterSpacing: '-0.03em' }}>90</span>
        <span style={{ fontFamily: UI.fontUi, fontSize: 10, color: UI.inkFaint, letterSpacing: '0.1em', marginLeft: 4 }}>{UI.unit().toUpperCase()}</span>
      </div>
      <div className="knurl" />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: 'center' }}>
        <span className="num" style={{ fontSize: 18, fontWeight: 300, color: 'var(--accent)' }}>45</span>
        <span style={{ fontFamily: UI.fontUi, fontSize: 9, color: UI.inkFaint, letterSpacing: '0.12em' }}>{UI.unit().toUpperCase()} PER SIDE</span>
      </div>
      <div style={{ display: 'flex', gap: 18, justifyContent: 'center', alignItems: 'flex-end', paddingTop: 2 }}>
        {plates.map(p => {
          const hole = Math.round(p.size * 0.3);
          return (
            <div key={p.kg} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ width: p.size, height: p.size, borderRadius: '50%', background: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', boxShadow: `0 4px 16px rgba(0,0,0,0.5), 0 0 0 1.5px rgba(255,255,255,0.18)` }}>
                <div style={{ position: 'absolute', width: hole, height: hole, borderRadius: '50%', background: 'var(--bg)', boxShadow: '0 0 0 1.5px rgba(255,255,255,0.18)' }} />
              </div>
              <span className="num" style={{ fontSize: 11, color: UI.inkSoft }}>{p.kg} × {p.n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TourVisualTrainSets() {
  const sets = [
    { label: '1', done: true },
    { label: '2', done: true },
    { label: '3', done: false },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
        {sets.map((s, i) => (
          <div key={s.label} style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto 28px 22px', alignItems: 'center', gap: 6, padding: '6px 10px', background: s.done ? `rgba(var(--accent-rgb),0.04)` : 'transparent', borderBottom: i < sets.length - 1 ? `0.5px solid ${UI.hair}` : 'none' }}>
            <div style={{ width: 20, height: 20, borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, color: UI.inkGhost }}>{s.label}</div>
            <div className="num" style={{ fontSize: 12, color: UI.ink }}>{`80 ${UI.unit()}`}</div>
            <div className="num" style={{ fontSize: 12, color: UI.inkSoft }}>8</div>
            <div style={{ width: 26, height: 26, borderRadius: 4, background: s.done ? 'var(--accent)' : UI.bgInset, border: `1px solid ${s.done ? 'var(--accent)' : UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {s.done && <i className="fa-solid fa-check" style={{ fontSize: 9, color: '#0a0805' }} />}
            </div>
            <div style={{ width: 20, height: 20, borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: UI.inkFaint, fontSize: 14, lineHeight: 1 }}>−</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 0', borderRadius: 4, background: 'transparent', border: `0.5px dashed ${UI.hairStrong}`, color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>
          <i className="fa-solid fa-plus" style={{ fontSize: 9 }} /> ADD SET
        </div>
        <div style={{ padding: '8px 12px', borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', gap: 5, color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>
          <i className="fa-solid fa-note-sticky" style={{ fontSize: 9 }} /> NOTE
        </div>
      </div>
    </div>
  );
}

function TourVisualTrainNotes() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
        {[1, 2].map((n, i) => (
          <div key={n} style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto 28px 22px', alignItems: 'center', gap: 6, padding: '6px 10px', background: `rgba(var(--accent-rgb),0.04)`, borderBottom: i === 0 ? `0.5px solid ${UI.hair}` : 'none' }}>
            <div style={{ width: 20, height: 20, borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontFamily: UI.fontUi, fontWeight: 700, color: UI.inkGhost }}>{n}</div>
            <div className="num" style={{ fontSize: 12, color: UI.ink }}>{`80 ${UI.unit()}`}</div>
            <div className="num" style={{ fontSize: 12, color: UI.inkSoft }}>8</div>
            <div style={{ width: 26, height: 26, borderRadius: 4, background: 'var(--accent)', border: `1px solid var(--accent)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className="fa-solid fa-check" style={{ fontSize: 9, color: '#0a0805' }} />
            </div>
            <div style={{ width: 20, height: 20, borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: UI.inkFaint, fontSize: 14, lineHeight: 1 }}>−</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 0', borderRadius: 4, background: 'transparent', border: `0.5px dashed ${UI.hairStrong}`, color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>
          <i className="fa-solid fa-plus" style={{ fontSize: 9 }} /> ADD SET
        </div>
        <div style={{ padding: '8px 12px', borderRadius: 4, background: `rgba(var(--accent-rgb),0.12)`, border: `1px solid rgba(var(--accent-rgb),0.4)`, boxShadow: `0 0 0 3px rgba(var(--accent-rgb),0.1)`, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--accent)', fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em' }}>
          <i className="fa-solid fa-note-sticky" style={{ fontSize: 9 }} /> NOTE
        </div>
      </div>
      <div style={{ padding: '10px 12px', background: `rgba(var(--accent-rgb),0.06)`, borderRadius: 6, border: `0.5px solid rgba(var(--accent-rgb),0.2)` }}>
        <div style={{ fontSize: 9, fontFamily: UI.fontUi, color: 'var(--accent)', marginBottom: 5, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Note</div>
        <div style={{ fontSize: 12, fontFamily: UI.fontUi, color: UI.inkSoft, lineHeight: 1.5 }}>Elbows at 45° — pause 1s at chest</div>
      </div>
    </div>
  );
}

function TourVisualTrainNav() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <TrainChips states={['done', 'active', 'pending']} />
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, padding: '8px 10px', display: 'flex', alignItems: 'center' }}>
        <span style={{ fontFamily: UI.fontDisplay, fontSize: 13, fontWeight: 700, color: UI.ink, textTransform: 'uppercase', flex: 1 }}>Incline DB</span>
        <span style={{ fontFamily: UI.fontUi, fontSize: 9, color: UI.inkGhost }}>0 / 3 done</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <i className="fa-solid fa-circle-info" style={{ fontSize: 10, color: UI.inkGhost }} />
        <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi }}>Tap a chip to jump to that exercise; done ones show a dot below the name</span>
      </div>
    </div>
  );
}

function TourVisualTrainSkip() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, padding: '9px 10px' }}>
        <span style={{ fontFamily: UI.fontDisplay, fontSize: 13, fontWeight: 700, color: UI.ink, textTransform: 'uppercase' }}>Leg Press</span>
        <div className="num" style={{ fontSize: 11, color: UI.inkFaint, marginTop: 2 }}>0 / 3 sets done</div>
      </div>
      <div style={{ background: UI.bgRaised, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, padding: '9px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}` }}>
          <i className="fa-solid fa-list" style={{ fontSize: 9, color: UI.inkFaint }} />
          <span style={{ fontFamily: UI.fontUi, fontSize: 9, color: UI.inkFaint, fontWeight: 700, letterSpacing: '0.07em' }}>EXERCISES</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 4, background: `rgba(var(--accent-rgb),0.1)`, border: `0.5px solid rgba(var(--accent-rgb),0.3)`, boxShadow: `0 0 0 3px rgba(var(--accent-rgb),0.08)` }}>
          <i className="fa-solid fa-forward-step" style={{ fontSize: 9, color: 'var(--accent)' }} />
          <span style={{ fontFamily: UI.fontUi, fontSize: 9, color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.07em' }}>SKIP REMAINING</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <i className="fa-solid fa-circle-info" style={{ fontSize: 10, color: UI.inkGhost }} />
        <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi }}>Marks unchecked sets as skipped and moves to the next exercise</span>
      </div>
    </div>
  );
}

function TourVisualTrainIntensity() {
  const techniques = [
    { label: 'DROP SET', sub: 'Descend the weight, keep the reps coming' },
    { label: 'LENGTHENED PARTIALS', sub: 'Full reps, then partials in the stretch' },
    { label: 'MYO REP', sub: 'Activation + minis to failure' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 4, background: `rgba(var(--accent-rgb),0.12)`, border: `0.5px solid rgba(var(--accent-rgb),0.4)` }}>
        <i className="fa-solid fa-bolt intensity-glow" style={{ fontSize: 10, color: 'var(--accent)' }} />
        <span style={{ fontFamily: UI.fontUi, fontSize: 9, color: 'var(--accent)', fontWeight: 700, letterSpacing: '0.08em' }}>INTENSITY</span>
      </div>
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
        {techniques.map((t, i) => (
          <div key={t.label} style={{ padding: '8px 11px', borderBottom: i < techniques.length - 1 ? `0.5px solid ${UI.hair}` : 'none' }}>
            <div style={{ fontSize: 11, fontFamily: UI.fontUi, fontWeight: 700, color: UI.ink, letterSpacing: '0.04em' }}>{t.label}</div>
            <div style={{ fontSize: 10.5, fontFamily: UI.fontUi, color: UI.inkFaint, marginTop: 2 }}>{t.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: `rgba(var(--accent-rgb),0.05)`, border: `0.5px solid rgba(var(--accent-rgb),0.2)`, borderRadius: 4 }}>
        <span style={{ fontSize: 9, fontFamily: UI.fontUi, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.06em' }}>DROP SET</span>
        <span style={{ fontSize: 10, fontFamily: UI.fontUi, color: UI.inkFaint }}>80 → 60 → 45 {UI.unit()}</span>
      </div>
    </div>
  );
}

function TourVisualTrainMeso() {
  const checks = [
    { title: 'Soreness check', q: 'Any soreness carryover from last session?', opts: ['Never sore', 'Healed a while ago', 'Still sore'] },
    { title: 'Joint check', q: 'Any joint discomfort?', opts: ['None', 'Noticeable', 'Sharp pain'] },
    { title: 'Pump & volume', q: 'How did the workload sit with you?', opts: ['Not enough', 'Just right', 'Too much'] },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {checks.map(c => (
        <div key={c.title} style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, padding: '9px 11px' }}>
          <div style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.1em', color: 'var(--accent)', fontWeight: 700, marginBottom: 3 }}>{c.title.toUpperCase()}</div>
          <div style={{ fontSize: 10.5, fontFamily: UI.fontUi, color: UI.inkSoft, marginBottom: 6 }}>{c.q}</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {c.opts.map((o, i) => (
              <span key={o} style={{
                fontSize: 9, fontFamily: UI.fontUi, padding: '4px 8px', borderRadius: 4,
                background: i === 1 ? 'rgba(var(--accent-rgb),0.14)' : UI.bgInset,
                border: `0.5px solid ${i === 1 ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`,
                color: i === 1 ? 'var(--accent)' : UI.inkFaint,
              }}>{o}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TourVisualTrainSaveTemplate() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'inline-flex', alignSelf: 'flex-start', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 6, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}` }}>
        <i className="fa-solid fa-floppy-disk" style={{ fontSize: 11, color: UI.inkSoft }} />
        <span style={{ fontSize: 11, fontFamily: UI.fontUi, fontWeight: 600, color: UI.inkSoft }}>Save as template</span>
      </div>
      <div style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.1em', color: UI.inkFaint }}>TEMPLATE NAME</div>
      <div style={{ padding: '10px 12px', borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset }}>
        <span style={{ fontSize: 12, fontFamily: UI.fontUi, color: UI.inkSoft }}>Push A</span>
      </div>
      <div style={{ padding: '10px 0', borderRadius: 6, textAlign: 'center', background: 'var(--accent)', color: '#0a0805', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700 }}>Save template</div>
    </div>
  );
}

function TourVisualTrainEnd() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, padding: '9px 10px' }}>
        <span style={{ fontFamily: UI.fontDisplay, fontSize: 13, fontWeight: 700, color: UI.ink, textTransform: 'uppercase' }}>Tricep Dip</span>
        <div style={{ fontSize: 9, fontFamily: UI.fontUi, color: 'var(--accent)', marginTop: 2, letterSpacing: '0.06em' }}>Last exercise</div>
      </div>
      <div style={{ background: UI.bgRaised, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, padding: '9px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}` }}>
          <i className="fa-solid fa-list" style={{ fontSize: 9, color: UI.inkFaint }} />
          <span style={{ fontFamily: UI.fontUi, fontSize: 9, color: UI.inkFaint, fontWeight: 700, letterSpacing: '0.07em' }}>EXERCISES</span>
        </div>
        <div className="num" style={{ flex: 1, fontSize: 12, color: UI.inkGhost, textAlign: 'center' }}>44:22</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 4, background: 'linear-gradient(160deg, var(--accent-light), var(--accent))', boxShadow: `0 4px 14px rgba(var(--accent-rgb),0.4)` }}>
          <span style={{ fontFamily: UI.fontUi, fontSize: 10, color: '#0a0805', fontWeight: 700, letterSpacing: '0.07em' }}>FINISH →</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <i className="fa-solid fa-circle-info" style={{ fontSize: 10, color: UI.inkGhost }} />
        <span style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi }}>Also auto-finishes when every set is checked off</span>
      </div>
    </div>
  );
}

function TourVisualTrainFeel() {
  const opts = [
    { key: 'easy', label: 'Easy', icon: 'fa-face-smile' },
    { key: 'good', label: 'Good', icon: 'fa-bolt' },
    { key: 'hard', label: 'Hard', icon: 'fa-fire' },
    { key: 'very_hard', label: 'Very Hard', icon: 'fa-skull' },
    { key: 'max', label: 'Max', icon: 'fa-trophy' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ textAlign: 'center', fontFamily: UI.fontUi, fontSize: 12, color: UI.inkSoft }}>How did it feel?</div>
      <div style={{ display: 'flex', gap: 5 }}>
        {opts.map((o, i) => (
          <div key={o.key} style={{
            flex: 1, padding: '8px 2px', borderRadius: 6, textAlign: 'center',
            background: i === 1 ? 'var(--accent)' : UI.bgInset,
            border: `0.5px solid ${i === 1 ? 'var(--accent)' : UI.hairStrong}`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
          }}>
            <i className={`fa-solid ${o.icon}`} style={{ fontSize: 13, color: i === 1 ? '#0a0805' : UI.inkFaint }} />
            <span style={{ fontSize: 7, fontFamily: UI.fontUi, fontWeight: 700, letterSpacing: '0.04em', color: i === 1 ? '#0a0805' : UI.inkFaint, lineHeight: 1.2 }}>{o.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TourVisualTrainWellDone() {
  return (
    <div style={{
      padding: '14px 12px', background: `rgba(var(--accent-rgb),0.06)`,
      border: `0.5px solid rgba(var(--accent-rgb),0.2)`,
      borderRadius: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    }}>
      <i className="fa-solid fa-trophy" style={{ fontSize: 28, color: 'var(--accent)' }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 20, color: UI.ink, fontWeight: 700, letterSpacing: '0.04em' }}>PUSH DAY</div>
        <div style={{ fontFamily: UI.fontUi, fontSize: 10, color: UI.inkFaint, marginTop: 2 }}>Mon, 15 Jun · 44 min</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, width: '100%' }}>
        {[['SETS', '18'], ['VOLUME', '6.2k'], ['PRs', '2']].map(([lbl, val]) => (
          <div key={lbl} style={{ textAlign: 'center', padding: '8px 4px', background: UI.bgCard, borderRadius: 4 }}>
            <div className="num" style={{ fontSize: 17, color: 'var(--accent)', fontWeight: 300 }}>{val}</div>
            <div style={{ fontSize: 8, fontFamily: UI.fontUi, color: UI.inkGhost, letterSpacing: '0.08em', marginTop: 2 }}>{lbl}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <i className="fa-solid fa-star" style={{ fontSize: 10, color: 'var(--accent)' }} />
        <span style={{ fontFamily: UI.fontUi, fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>2 new personal records</span>
      </div>
    </div>
  );
}

// ─── Quick Actions tour visuals ──────────────────────────────────────
// Mirrors the real action-row look from the Quick Actions sheet
// (src/screens-home.jsx, actionBtn helper) so the tour matches what users see.
function qaRow(icon, label, sub) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '12px 14px', background: UI.bgInset, border: `0.5px solid ${UI.hair}`,
      borderRadius: 6,
    }}>
      <i className={`fa-solid ${icon}`} style={{ fontSize: 20, color: 'var(--accent)', width: 22, textAlign: 'center', flexShrink: 0 }} />
      <div style={{ flex: 1, textAlign: 'left' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', fontFamily: UI.fontUi }}>{label}</div>
        <div style={{ fontSize: 12, color: UI.inkSoft, marginTop: 2, fontFamily: UI.fontUi }}>{sub}</div>
      </div>
      <svg width="7" height="12" viewBox="0 0 7 12" fill="none" stroke={UI.inkFaint} strokeWidth="1.5" strokeLinecap="round"><path d="M1 1l5 5-5 5"/></svg>
    </div>
  );
}
function TourVisualQuickActionsSwipe() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <svg width="16" height="10" viewBox="0 0 12 7" fill="none"><path d="M1 1l5 4.5L11 1" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <svg width="16" height="10" viewBox="0 0 12 7" fill="none" style={{ opacity: 0.5 }}><path d="M1 1l5 4.5L11 1" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 999, background: 'rgba(var(--accent-rgb),0.12)', border: '0.5px solid rgba(var(--accent-rgb),0.3)' }}>
        <span style={{ fontFamily: UI.fontUi, fontSize: 10, letterSpacing: '0.18em', fontWeight: 700, color: 'var(--accent)' }}>QUICK ACTIONS</span>
      </div>
      <div style={{ fontSize: 10, color: UI.inkGhost, fontFamily: UI.fontUi }}>swipe down anywhere on Home</div>
    </div>
  );
}
function TourVisualQuickActionsDailyLog() { return qaRow('fa-calendar-day', 'Daily Log', 'Weight, macros, water & steps'); }
function TourVisualQuickActionsWorkout() { return qaRow('fa-dumbbell', 'Workout', 'From plan or freestyle'); }
function TourVisualQuickActionsBacklog() { return qaRow('fa-clock-rotate-left', 'Backlog Session', 'Log Push Day (2d ago)'); }
function TourVisualQuickActionsCardio() { return qaRow('fa-person-running', 'Cardio', 'Start live or log manually'); }
function TourVisualQuickActionsCheckin() { return qaRow('fa-clipboard-check', 'Check-in', "This week's check-in is due"); }
function TourVisualQuickActionsMessage() { return qaRow('fa-message', 'Message Coach', 'Send a note to your coach'); }

function TourVisualHealthEnable() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ background: UI.bgCard, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', borderBottom: `0.5px solid ${UI.hair}` }}>
          <span style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.12em', color: UI.inkFaint }}>SETTINGS → HEALTH</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 10 }}>
          <span style={{ flex: 1, fontSize: 13, fontFamily: UI.fontUi, color: UI.ink }}>Show Health tab</span>
          <div style={{ width: 44, height: 26, borderRadius: 13, background: 'var(--accent)', position: 'relative', flexShrink: 0 }}>
            <div style={{ position: 'absolute', right: 3, top: 3, width: 20, height: 20, borderRadius: '50%', background: '#0a0805' }} />
          </div>
        </div>
      </div>
      <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, lineHeight: 1.5, padding: '0 2px' }}>
        After enabling, the Health tab appears in the bottom navigation bar.
      </div>
    </div>
  );
}

function TourVisualHealthCardio() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 10, color: UI.inkFaint, fontFamily: UI.fontUi, padding: '0 2px' }}>Home screen — bottom of the page</div>
      <div style={{
        width: '100%', padding: '11px 16px',
        background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
        border: '1px solid rgba(var(--accent-rgb),0.6)',
        borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <i className="fa-solid fa-person-running" style={{ fontSize: 13, color: 'rgba(10,8,5,0.6)' }} />
        <span style={{ fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', color: 'rgba(10,8,5,0.75)' }}>CARDIO</span>
      </div>
      <div style={{ background: UI.bgCard, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, overflow: 'hidden' }}>
        {[
          { icon: 'fa-stopwatch', label: 'Start live', accent: true },
          { icon: 'fa-pen', label: 'Log manually', accent: false },
        ].map((item, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            borderBottom: i === 0 ? `0.5px solid ${UI.hair}` : 'none',
          }}>
            <i className={`fa-solid ${item.icon}`} style={{ fontSize: 12, color: item.accent ? 'var(--accent)' : UI.inkFaint, width: 14, textAlign: 'center' }} />
            <span style={{ fontSize: 12, fontFamily: UI.fontUi, color: item.accent ? 'var(--accent)' : UI.inkSoft }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TourVisualHealthLog() {
  const field = (label, value, unit) => (
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', borderBottom: `0.5px solid ${UI.hair}` }}>
      <span style={{ flex: 1, fontSize: 12, fontFamily: UI.fontUi, color: UI.inkSoft }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span className="num" style={{ fontSize: 14, color: UI.ink }}>{value}</span>
        {unit && <span style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi }}>{unit}</span>}
      </span>
    </div>
  );
  return (
    <div style={{ background: UI.bgCard, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ padding: '8px 10px', borderBottom: `0.5px solid ${UI.hairStrong}` }}>
        <span style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.12em', color: UI.inkFaint }}>TODAY'S LOG</span>
      </div>
      {field('Body weight', '82.4', UI.unit())}
      {field('Steps', '9 200')}
      {field('Calories', '2 180', 'kcal')}
      {field('Protein', '185', 'g')}
      {field('Carbs', '240', 'g')}
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1, fontSize: 12, fontFamily: UI.fontUi, color: UI.inkSoft }}>Fat</span>
        <span className="num" style={{ fontSize: 14, color: UI.ink }}>68 <span style={{ fontSize: 9, color: UI.inkFaint }}>g</span></span>
      </div>
    </div>
  );
}

function TourVisualHealthWeek() {
  const bar = (label, pct, color) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkFaint, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontSize: 9, fontFamily: UI.fontUi, color: color }}>{pct}%</span>
      </div>
      <div style={{ height: 5, borderRadius: 4, background: UI.bgInset, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color }} />
      </div>
    </div>
  );
  return (
    <div style={{ background: UI.bgCard, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.12em', color: UI.inkFaint }}>THIS WEEK</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 9, fontFamily: UI.fontUi, color: 'var(--ok)' }}>STRONG WEEK</span>
      </div>
      {bar('Macro adherence', 92, 'var(--ok)')}
      {bar('Training', 75, 'var(--accent)')}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 4 }}>
        {[['Avg weight', '82.1', UI.unit()], ['Steps avg', '9.4k', ''], ['Cardio', '85', 'min']].map(([lbl, val, unit]) => (
          <div key={lbl} style={{ textAlign: 'center', padding: '6px 4px', background: UI.bgInset, borderRadius: 4 }}>
            <div className="num" style={{ fontSize: 14, color: UI.ink, fontWeight: 300 }}>{val}<span style={{ fontSize: 8, color: UI.inkFaint, marginLeft: 2 }}>{unit}</span></div>
            <div style={{ fontSize: 7.5, fontFamily: UI.fontUi, color: UI.inkGhost, letterSpacing: '0.07em', marginTop: 2, textTransform: 'uppercase' }}>{lbl}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Cardio plans tour visuals ───────────────────────────────────────
function TourVisualCardioIntro() {
  const modes = [
    { icon: 'fa-calendar-days', label: 'Manual', sub: 'Fixed weekly targets' },
    { icon: 'fa-bullseye', label: 'Goal', sub: 'Progressive plan to a due date' },
  ];
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {modes.map((m, i) => (
        <div key={m.label} style={{
          flex: 1, padding: '14px 10px', borderRadius: 6, textAlign: 'center',
          background: i === 1 ? 'rgba(var(--accent-rgb),0.08)' : UI.bgInset,
          border: `0.5px solid ${i === 1 ? 'rgba(var(--accent-rgb),0.35)' : UI.hairStrong}`,
        }}>
          <i className={`fa-solid ${m.icon}`} style={{ fontSize: 18, color: i === 1 ? 'var(--accent)' : UI.inkFaint }} />
          <div style={{ fontSize: 12, fontFamily: UI.fontUi, fontWeight: 700, color: i === 1 ? 'var(--accent)' : UI.inkSoft, marginTop: 8 }}>{m.label}</div>
          <div style={{ fontSize: 9.5, fontFamily: UI.fontUi, color: UI.inkFaint, marginTop: 3 }}>{m.sub}</div>
        </div>
      ))}
    </div>
  );
}

function TourVisualCardioActivity() {
  const activities = [
    { icon: 'fa-person-running', label: 'Running' }, { icon: 'fa-person-walking', label: 'Walking' },
    { icon: 'fa-person-biking', label: 'Cycling' }, { icon: 'fa-person-swimming', label: 'Swimming' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 7 }}>
      {activities.map((a, i) => (
        <div key={a.label} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 11px', borderRadius: 6,
          background: i === 0 ? 'rgba(var(--accent-rgb),0.1)' : UI.bgInset,
          border: `0.5px solid ${i === 0 ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`,
        }}>
          <i className={`fa-solid ${a.icon}`} style={{ fontSize: 13, color: i === 0 ? 'var(--accent)' : UI.inkFaint }} />
          <span style={{ fontSize: 11, fontFamily: UI.fontUi, fontWeight: 600, color: i === 0 ? 'var(--accent)' : UI.inkSoft }}>{a.label}</span>
        </div>
      ))}
    </div>
  );
}

function TourVisualCardioManual() {
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {days.map((d, i) => (
          <div key={i} style={{
            flex: 1, textAlign: 'center', padding: '7px 0', borderRadius: 4,
            background: [0, 2, 4].includes(i) ? 'var(--accent)' : UI.bgInset,
            color: [0, 2, 4].includes(i) ? '#0a0805' : UI.inkFaint,
            fontFamily: UI.fontUi, fontSize: 10, fontWeight: 700,
          }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '9px 12px', background: UI.bgCard, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6 }}>
        <span className="num" style={{ fontSize: 18, color: UI.ink, fontWeight: 300 }}>5.0</span>
        <span style={{ fontSize: 10, fontFamily: UI.fontUi, color: UI.inkFaint }}>km per session</span>
      </div>
    </div>
  );
}

function TourVisualCardioGoal() {
  const field = (label, value) => (
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', borderBottom: `0.5px solid ${UI.hair}` }}>
      <span style={{ flex: 1, fontSize: 10.5, fontFamily: UI.fontUi, color: UI.inkFaint, letterSpacing: '0.04em' }}>{label}</span>
      <span className="num" style={{ fontSize: 13, color: UI.ink }}>{value}</span>
    </div>
  );
  return (
    <div style={{ background: UI.bgCard, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, overflow: 'hidden' }}>
      {field('TARGET DISTANCE', '10.0 km')}
      {field('DUE DATE', 'Sep 20')}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px' }}>
        <span style={{ flex: 1, fontSize: 10.5, fontFamily: UI.fontUi, color: UI.inkFaint, letterSpacing: '0.04em' }}>CURRENT PACE</span>
        <span className="num" style={{ fontSize: 13, color: 'var(--accent)' }}>5:30/km</span>
      </div>
    </div>
  );
}

function TourVisualCardioPreview() {
  const sessions = [
    { n: 1, val: '5.0 km' }, { n: 8, val: '6.4 km' }, { n: 8, val: '5.6 km', deload: true }, { n: 16, val: '10.0 km', goal: true },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ padding: '9px 11px', background: `rgba(var(--accent-rgb),0.08)`, border: `0.5px solid rgba(var(--accent-rgb),0.25)`, borderRadius: 6, fontSize: 10.5, fontFamily: UI.fontUi, color: UI.inkSoft, lineHeight: 1.5 }}>
        16 sessions over 8 weeks. Every 4th week is a lighter recovery week.
      </div>
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
        {sessions.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '7px 11px', borderBottom: i < sessions.length - 1 ? `0.5px solid ${UI.hair}` : 'none', background: s.goal ? 'rgba(var(--accent-rgb),0.06)' : 'transparent' }}>
            <span style={{ flex: 1, fontSize: 10.5, fontFamily: UI.fontUi, color: s.deload ? UI.inkFaint : UI.inkSoft }}>Session {s.n}{s.deload ? ' (deload)' : ''}</span>
            <span className="num" style={{ fontSize: 12, color: s.goal ? 'var(--accent)' : UI.ink }}>{s.val}{s.goal ? ' · Goal' : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TourVisualCardioActivate() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid rgba(var(--accent-rgb),0.35)` }}>
        <i className="fa-solid fa-person-running" style={{ fontSize: 14, color: 'var(--accent)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>Running Plan</div>
          <div style={{ fontSize: 9.5, color: UI.inkFaint, fontFamily: UI.fontUi }}>GOAL PLAN · Session 8/16</div>
        </div>
        <span style={{ fontSize: 9, fontFamily: UI.fontUi, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.06em' }}>● ACTIVE</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${UI.hair}`, opacity: 0.6 }}>
        <i className="fa-solid fa-person-biking" style={{ fontSize: 14, color: UI.inkFaint }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12.5, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>Cycling Plan</div>
          <div style={{ fontSize: 9.5, color: UI.inkFaint, fontFamily: UI.fontUi }}>MANUAL PLAN</div>
        </div>
      </div>
    </div>
  );
}

// ─── Status modes (deload/sick/vacation) tour visuals ────────────────
function TourVisualStatusIntro() {
  const modes = [
    { icon: 'fa-battery-quarter', label: 'DELOAD' },
    { icon: 'fa-bed-pulse', label: 'SICK' },
    { icon: 'fa-umbrella-beach', label: 'VACATION' },
  ];
  return (
    <div style={{ display: 'flex', gap: 7 }}>
      {modes.map(m => (
        <div key={m.label} style={{ flex: 1, textAlign: 'center', padding: '13px 6px', borderRadius: 6, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}` }}>
          <i className={`fa-solid ${m.icon}`} style={{ fontSize: 16, color: 'var(--accent)' }} />
          <div style={{ fontSize: 9, fontFamily: UI.fontUi, fontWeight: 700, color: UI.inkSoft, letterSpacing: '0.06em', marginTop: 7 }}>{m.label}</div>
        </div>
      ))}
    </div>
  );
}

function TourVisualStatusDeload() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px', borderRadius: 6, background: `rgba(var(--accent-rgb),0.1)`, border: `0.5px solid rgba(var(--accent-rgb),0.35)` }}>
        <i className="fa-solid fa-arrow-rotate-left" style={{ fontSize: 13, color: 'var(--accent)' }} />
        <span style={{ fontSize: 11.5, fontFamily: UI.fontUi, fontWeight: 700, color: 'var(--accent)' }}>DELOAD ACTIVE · 4d left · END</span>
      </div>
      <div style={{ display: 'inline-flex', alignSelf: 'flex-start', padding: '5px 10px', borderRadius: 4, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}` }}>
        <span style={{ fontSize: 9.5, fontFamily: UI.fontUi, fontWeight: 700, color: UI.inkSoft, letterSpacing: '0.06em' }}>DELOAD · 50%</span>
      </div>
    </div>
  );
}

function TourVisualStatusNudge() {
  return (
    <div style={{ background: UI.bgCard, border: `1px solid ${UI.goldSoft}`, borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'center' }}>
      <div style={{ fontFamily: UI.fontDisplay, fontSize: 18, color: UI.ink, fontWeight: 700 }}>Mesocycle complete! 🎉</div>
      <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>A deload now helps you recover and come back even stronger. Want to start one?</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <div style={{ flex: 1, padding: '8px 0', borderRadius: 6, textAlign: 'center', background: 'var(--accent)', color: '#0a0805', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700 }}>Start deload</div>
        <div style={{ flex: 1, padding: '8px 0', borderRadius: 6, textAlign: 'center', border: `0.5px solid ${UI.hairStrong}`, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700 }}>Skip deload</div>
      </div>
    </div>
  );
}

function TourVisualStatusSickVacation() {
  const opts = [
    { mode: 'sick', label: 'Sick', icon: 'fa-bed-pulse' },
    { mode: null, label: 'Normal', icon: 'fa-circle-check' },
    { mode: 'vacation', label: 'Vacation', icon: 'fa-umbrella-beach' },
  ];
  return (
    <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: `0.5px solid ${UI.hairStrong}` }}>
      {opts.map((o, i) => {
        const active = o.mode === 'sick';
        return (
          <div key={String(o.mode)} style={{
            flex: 1, padding: '12px 4px', borderLeft: i > 0 ? `0.5px solid ${UI.hairStrong}` : 'none',
            background: active ? 'var(--accent)' : 'transparent',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
          }}>
            <i className={`fa-solid ${o.icon}`} style={{ fontSize: 13, color: active ? '#0a0805' : UI.inkFaint }} />
            <span style={{ fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: active ? '#0a0805' : UI.inkFaint }}>{o.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Customize tour visuals ───────────────────────────────────────────
function TourVisualCustomIntro() {
  const items = ['fa-palette', 'fa-stopwatch', 'fa-dumbbell', 'fa-chart-line'];
  return (
    <div style={{ display: 'flex', gap: 7 }}>
      {items.map((ic, i) => (
        <div key={ic} style={{ flex: 1, textAlign: 'center', padding: '13px 4px', borderRadius: 6, background: i === 0 ? 'rgba(var(--accent-rgb),0.1)' : UI.bgInset, border: `0.5px solid ${i === 0 ? 'rgba(var(--accent-rgb),0.35)' : UI.hairStrong}` }}>
          <i className={`fa-solid ${ic}`} style={{ fontSize: 15, color: i === 0 ? 'var(--accent)' : UI.inkFaint }} />
        </div>
      ))}
    </div>
  );
}

function TourVisualCustomAppearance() {
  const colors = Object.values(window.ACCENT_PALETTE).map(c => c.hex).slice(0, 5);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {colors.map((c, i) => (
          <div key={c} style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: i === 0 ? '2px solid #fff' : 'none', boxShadow: i === 0 ? '0 0 0 2px var(--accent)' : 'none' }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 5 }}>
        {['Dark', 'Black', 'Light'].map((t, i) => (
          <div key={t} style={{ flex: 1, textAlign: 'center', padding: '7px 0', borderRadius: 4, background: i === 0 ? 'var(--accent)' : UI.bgInset, color: i === 0 ? '#0a0805' : UI.inkFaint, fontFamily: UI.fontUi, fontSize: 10, fontWeight: 600 }}>{t}</div>
        ))}
      </div>
    </div>
  );
}

function TourVisualCustomRest() {
  const rows = [['Big', '180s'], ['Medium', '120s'], ['Small', '90s']];
  return (
    <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, overflow: 'hidden' }}>
      {rows.map(([label, val], i) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', padding: '9px 12px', borderBottom: i < rows.length - 1 ? `0.5px solid ${UI.hair}` : 'none' }}>
          <span style={{ flex: 1, fontSize: 11.5, fontFamily: UI.fontUi, color: UI.inkSoft }}>{label}</span>
          <span className="num" style={{ fontSize: 13, color: UI.ink }}>{val}</span>
        </div>
      ))}
    </div>
  );
}

function TourVisualCustomEquipment() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ background: UI.bgCard, borderRadius: 6, border: `0.5px solid ${UI.hairStrong}`, padding: '9px 12px', display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1, fontSize: 11, fontFamily: UI.fontUi, color: UI.inkSoft }}>Barbell — increment</span>
        <span className="num" style={{ fontSize: 12, color: UI.ink }}>{`2.5 ${UI.unit()}`}</span>
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', paddingTop: 2 }}>
        {[{ c: '#c0392b', on: true }, { c: '#2471a3', on: true }, { c: '#27ae60', on: false }].map((p, i) => (
          <div key={i} style={{ width: 30, height: 30, borderRadius: '50%', background: p.c, opacity: p.on ? 1 : 0.25 }} />
        ))}
      </div>
    </div>
  );
}

function TourVisualCustomProgression() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tourToggleRow('Smart progression', 'Rep range top +4', true)}
      <div style={{ fontSize: 10, fontFamily: UI.fontUi, color: UI.inkFaint, lineHeight: 1.5, padding: '0 2px' }}>
        Target 8 reps → weight increases once every set reaches 12.
      </div>
    </div>
  );
}

function TourVisualCustomPaceguard() {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {[['Eccentric', '3s'], ['Concentric', '1s']].map(([label, val]) => (
        <div key={label} style={{ flex: 1, textAlign: 'center', padding: '11px 6px', background: UI.bgCard, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6 }}>
          <div className="num" style={{ fontSize: 17, color: 'var(--accent)', fontWeight: 300 }}>{val}</div>
          <div style={{ fontSize: 9, fontFamily: UI.fontUi, color: UI.inkFaint, marginTop: 3, letterSpacing: '0.06em' }}>{label.toUpperCase()}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Coaching tour visuals ───────────────────────────────────────────
function TourVisualCoachEnable() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ background: UI.bgCard, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', borderBottom: `0.5px solid ${UI.hair}` }}>
          <span style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.12em', color: UI.inkFaint }}>SETTINGS → COACHING</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 10 }}>
          <span style={{ flex: 1, fontSize: 13, fontFamily: UI.fontUi, color: UI.ink }}>Coaching tab</span>
          <div style={{ width: 44, height: 26, borderRadius: 13, background: 'var(--accent)', position: 'relative', flexShrink: 0 }}>
            <div style={{ position: 'absolute', right: 3, top: 3, width: 20, height: 20, borderRadius: '50%', background: '#0a0805' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TourVisualCoachRoles() {
  const tabs = [
    { label: 'My Clients', icon: 'fa-users', active: true },
    { label: 'My Coach', icon: 'fa-person-chalkboard' },
    { label: 'Myself', icon: 'fa-chart-line' },
  ];
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {tabs.map((t, i) => (
        <div key={i} style={{
          flex: 1, padding: '9px 4px', borderRadius: 6, textAlign: 'center',
          background: t.active ? 'rgba(var(--accent-rgb),0.10)' : UI.bgInset,
          border: `0.5px solid ${t.active ? 'rgba(var(--accent-rgb),0.4)' : UI.hairStrong}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        }}>
          <i className={`fa-solid ${t.icon}`} style={{ fontSize: 13, color: t.active ? 'var(--accent)' : UI.inkFaint }} />
          <span style={{ fontSize: 8, fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.04em', color: t.active ? 'var(--accent)' : UI.inkFaint }}>{t.label}</span>
        </div>
      ))}
    </div>
  );
}

function TourVisualCoachInviteAccept() {
  return (
    <div style={{ background: UI.bgCard, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="micro-gold" style={{ letterSpacing: '0.15em' }}>COACHING REQUEST</span>
      <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, fontWeight: 700, color: UI.ink }}>Coach Mike</div>
      <div style={{ fontSize: 11, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5, marginBottom: 6 }}>
        wants to coach you. They'll be able to view your training, sessions and plans, and adjust them on your behalf.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, padding: '9px 0', borderRadius: 6, textAlign: 'center', background: 'var(--accent)', color: '#0a0805', fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em' }}>ACCEPT</div>
        <div style={{ flex: 1, padding: '9px 0', borderRadius: 6, textAlign: 'center', background: 'transparent', border: `0.5px solid ${UI.hairStrong}`, color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em' }}>DECLINE</div>
      </div>
    </div>
  );
}

function TourVisualCoachCheckin() {
  const marker = (label, val) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontFamily: UI.fontUi, color: UI.inkSoft }}>{label}</span>
        <span className="num" style={{ fontSize: 9, color: 'var(--accent)' }}>{val}/10</span>
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} style={{ flex: 1, height: 5, borderRadius: 4, background: i < val ? 'var(--accent)' : UI.bgInset }} />
        ))}
      </div>
    </div>
  );
  return (
    <div style={{ background: UI.bgCard, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '12px 14px' }}>
      <div style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.12em', color: UI.inkFaint, marginBottom: 10 }}>WEEK OF 08 – 14 JUN</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, background: UI.bgInset, borderRadius: 4, padding: '7px 9px' }}>
          <div style={{ fontSize: 8, color: UI.inkFaint, fontFamily: UI.fontUi }}>WEIGHT TODAY</div>
          <div className="num" style={{ fontSize: 15, color: UI.ink }}>82.4</div>
        </div>
        <div style={{ flex: 1, background: UI.bgInset, borderRadius: 4, padding: '7px 9px' }}>
          <div style={{ fontSize: 8, color: UI.inkFaint, fontFamily: UI.fontUi }}>VS LAST WEEK</div>
          <div style={{ fontSize: 13, color: 'var(--accent)', fontFamily: UI.fontUi, fontWeight: 600, marginTop: 2 }}>Improved</div>
        </div>
      </div>
      {marker('Sleep', 8)}
      {marker('Hunger', 4)}
    </div>
  );
}

function TourVisualCoachMacros() {
  const day = (label, cal, p, c, f) => (
    <div style={{ flex: 1, background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ fontSize: 8, fontFamily: UI.fontUi, letterSpacing: '0.1em', color: UI.inkFaint, marginBottom: 6 }}>{label}</div>
      <div className="num" style={{ fontSize: 18, color: 'var(--accent)', fontWeight: 300 }}>{cal}<span style={{ fontSize: 9, color: UI.inkFaint }}> kcal</span></div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        {[['P', p], ['C', c], ['F', f]].map(([k, v]) => (
          <div key={k}>
            <div style={{ fontSize: 8, color: UI.inkGhost, fontFamily: UI.fontUi }}>{k}</div>
            <div className="num" style={{ fontSize: 11, color: UI.inkSoft }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {day('TRAINING DAY', '2 600', '200', '300', '70')}
      {day('REST DAY', '2 200', '200', '180', '70')}
    </div>
  );
}

function TourVisualCoachNotes() {
  const bubble = (text, mine) => (
    <div style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '80%', padding: '8px 11px', borderRadius: 8,
        background: mine ? 'var(--accent)' : UI.bgInset,
        border: mine ? 'none' : `0.5px solid ${UI.hairStrong}`,
        color: mine ? '#0a0805' : UI.inkSoft,
        fontFamily: UI.fontUi, fontSize: 11, lineHeight: 1.45,
      }}>{text}</div>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {bubble(`Bench felt strong this week — added 2.5 ${UI.unit()}.`, false)}
      {bubble('Nice. Hold the same load next session, then we deload.', true)}
    </div>
  );
}

function TourVisualCoachInvite() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.12em', color: UI.inkFaint }}>INVITE CLIENT</div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '11px 13px', borderRadius: 4, border: `1px solid ${UI.hairStrong}`, background: UI.bgInset }}>
        <span style={{ fontSize: 12, fontFamily: UI.fontUi, color: UI.inkSoft }}>client@email.com</span>
      </div>
      <div style={{ padding: '11px 0', borderRadius: 6, textAlign: 'center', background: 'var(--accent)', color: '#0a0805', fontFamily: UI.fontUi, fontSize: 12, fontWeight: 700 }}>Send Invite</div>
    </div>
  );
}

function TourVisualCoachClients() {
  const card = (name, status, color, live) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 13px', background: UI.bgInset, borderRadius: 8, border: `0.5px solid ${live ? 'rgba(var(--accent-rgb),0.4)' : UI.hair}` }}>
      <div style={{ width: 34, height: 34, borderRadius: '50%', background: UI.bgRaised, border: `0.5px solid ${UI.hairStrong}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
        <span style={{ fontFamily: UI.fontUi, fontSize: 14, color: UI.inkSoft, fontWeight: 700 }}>{name[0]}</span>
        {live && <div style={{ position: 'absolute', top: -1, right: -1, width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', border: '2px solid var(--bg)' }} />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: UI.ink, fontFamily: UI.fontUi, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 9, color, fontFamily: UI.fontUi, fontWeight: 600, letterSpacing: '0.06em' }}>{status}</div>
      </div>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {card('Mike', 'TRAINING NOW', 'var(--accent)', true)}
      {card('Sara', 'CHECK-IN DUE', 'rgba(var(--accent-rgb),0.7)', false)}
    </div>
  );
}

function TourVisualCoachTrends() {
  const spark = (pts) => {
    const w = 84, h = 26;
    const max = Math.max(...pts), min = Math.min(...pts);
    const range = max - min || 1;
    const d = pts.map((p, i) => `${(i / (pts.length - 1) * w).toFixed(1)},${(h - (p - min) / range * h).toFixed(1)}`).join(' ');
    return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}><polyline points={d} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  };
  const row = (label, val, pts) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: UI.bgInset, borderRadius: 6 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
        <div className="num" style={{ fontSize: 15, color: UI.ink }}>{val}</div>
      </div>
      {spark(pts)}
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {row('Body weight', `82.4 ${UI.unit()}`, [85, 84.4, 84, 83.3, 82.8, 82.4])}
      {row('Sleep', '8 / 10', [6, 7, 6, 8, 7, 8])}
    </div>
  );
}

function TourVisualCoachSchema() {
  const field = (label, type) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px', background: UI.bgInset, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 4 }}>
      <i className="fa-solid fa-grip-vertical" style={{ fontSize: 11, color: UI.inkGhost }} />
      <span style={{ flex: 1, fontSize: 11, fontFamily: UI.fontUi, color: UI.inkSoft }}>{label}</span>
      <span style={{ fontSize: 8, fontFamily: UI.fontUi, color: UI.inkFaint, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{type}</span>
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 9, fontFamily: UI.fontUi, letterSpacing: '0.12em', color: UI.inkFaint }}>CHECK-IN FORM · MARKERS</div>
      {field('Sleep quality', 'scale')}
      {field('Hunger', 'scale')}
      {field('Weekly weight', 'number')}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px' }}>
        <span style={{ color: 'var(--accent)', fontSize: 15, lineHeight: 1, fontWeight: 300 }}>+</span>
        <span style={{ fontFamily: UI.fontUi, fontSize: 10, color: 'var(--accent)', letterSpacing: '0.08em', fontWeight: 600 }}>ADD FIELD</span>
      </div>
    </div>
  );
}

function TourVisualCoachSelf() {
  return (
    <div style={{ background: UI.bgCard, border: `0.5px solid ${UI.hairStrong}`, borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', gap: 10 }}>
        <i className="fa-solid fa-chart-line" style={{ fontSize: 13, color: 'var(--accent)', width: 16, textAlign: 'center' }} />
        <span style={{ flex: 1, fontSize: 13, fontFamily: UI.fontUi, color: UI.ink }}>Be your own coach</span>
        <div style={{ width: 44, height: 26, borderRadius: 13, background: 'var(--accent)', position: 'relative', flexShrink: 0 }}>
          <div style={{ position: 'absolute', right: 3, top: 3, width: 20, height: 20, borderRadius: '50%', background: '#0a0805' }} />
        </div>
      </div>
    </div>
  );
}

// ─── PWA install visuals (iOS) ───────────────────────────────────────

function TourVisualPwaIosSafari() {
  return (
    <div style={{ background: '#1c1c1e', borderRadius: 8, overflow: 'hidden', border: '0.5px solid #3a3a3c' }}>
      <div style={{ background: '#2c2c2e', padding: '8px 10px' }}>
        <div style={{ background: '#3a3a3c', borderRadius: 8, padding: '5px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <i className="fa-solid fa-lock" style={{ fontSize: 8, color: '#8e8e93' }} />
          <span style={{ fontSize: 11, color: '#ebebf5', fontFamily: UI.fontUi }}>zane-wo.com</span>
        </div>
      </div>
      <div style={{ padding: '10px 12px', background: UI.bgCard }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: '#0a0805', fontFamily: UI.fontDisplay }}>Z</span>
          </div>
          <span style={{ fontSize: 12, fontFamily: UI.fontUi, fontWeight: 600, color: UI.ink }}>ZANE</span>
          <span style={{ marginLeft: 'auto', fontSize: 9, color: UI.inkFaint, fontFamily: UI.fontUi, background: '#2c4a2c', padding: '2px 6px', borderRadius: 4 }}>Safari</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['TRAIN', 'PLAN', 'HEALTH'].map(t => (
            <div key={t} style={{ flex: 1, background: UI.bgInset, borderRadius: 4, padding: '5px 0', textAlign: 'center' }}>
              <span style={{ fontSize: 8, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.06em' }}>{t}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: '#2c2c2e', borderTop: '0.5px solid #3a3a3c', padding: '7px 10px 6px', display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3a3a3c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3a3a3c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8e8e93" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8e8e93" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8e8e93" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="8" height="8" rx="1"/><rect x="14" y="7" width="8" height="8" rx="1"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/></svg>
      </div>
    </div>
  );
}

function TourVisualPwaIosShare() {
  return (
    <div style={{ background: '#1c1c1e', borderRadius: 8, overflow: 'hidden', border: '0.5px solid #3a3a3c' }}>
      <div style={{ background: '#2c2c2e', padding: '8px 10px' }}>
        <div style={{ background: '#3a3a3c', borderRadius: 8, padding: '5px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <i className="fa-solid fa-lock" style={{ fontSize: 8, color: '#8e8e93' }} />
          <span style={{ fontSize: 11, color: '#ebebf5', fontFamily: UI.fontUi }}>zane-wo.com</span>
        </div>
      </div>
      <div style={{ padding: '10px 12px', background: UI.bgCard, opacity: 0.4 }}>
        <div style={{ height: 44, background: UI.bgInset, borderRadius: 4 }} />
      </div>
      <div style={{ background: '#2c2c2e', borderTop: '0.5px solid #3a3a3c', padding: '6px 10px', display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3a3a3c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3a3a3c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        <div style={{ padding: '5px 6px', borderRadius: 6, background: 'rgba(var(--accent-rgb),0.15)', border: '1.5px solid var(--accent)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
        </div>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8e8e93" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8e8e93" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="8" height="8" rx="1"/><rect x="14" y="7" width="8" height="8" rx="1"/><path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/></svg>
      </div>
    </div>
  );
}

function TourVisualPwaIosAddToHome() {
  return (
    <div style={{ background: '#1c1c1e', borderRadius: 8, overflow: 'hidden', border: '0.5px solid #3a3a3c' }}>
      <div style={{ background: '#2c2c2e', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#0a0805', fontFamily: UI.fontDisplay }}>Z</span>
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#ebebf5', fontFamily: UI.fontUi, fontWeight: 600 }}>Zane</div>
          <div style={{ fontSize: 9, color: '#8e8e93', fontFamily: UI.fontUi }}>zane-wo.com</div>
        </div>
      </div>
      <div style={{ background: '#2c2c2e', padding: '6px 10px', display: 'flex', gap: 10, borderTop: '0.5px solid #3a3a3c' }}>
        {[{ icon: 'fa-message', color: '#32c759' }, { icon: 'fa-envelope', color: '#0a84ff' }, { icon: 'fa-copy', color: '#636366' }].map((item, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: item.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className={`fa-solid ${item.icon}`} style={{ fontSize: 14, color: '#fff' }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: '#2c2c2e', borderTop: '0.5px solid #3a3a3c' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(var(--accent-rgb),0.12)', borderLeft: '2.5px solid var(--accent)' }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: '#48484a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ebebf5" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </div>
          <span style={{ fontSize: 12, color: 'var(--accent)', fontFamily: UI.fontUi, fontWeight: 600 }}>Add to Home Screen</span>
        </div>
        <div style={{ height: 0.5, background: '#3a3a3c' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px' }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: '#48484a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <i className="fa-regular fa-bookmark" style={{ fontSize: 11, color: '#8e8e93' }} />
          </div>
          <span style={{ fontSize: 12, color: '#8e8e93', fontFamily: UI.fontUi }}>Add Bookmark</span>
        </div>
      </div>
    </div>
  );
}

function TourVisualPwaIosAdd() {
  return (
    <div style={{ background: '#1c1c1e', borderRadius: 8, overflow: 'hidden', border: '0.5px solid #3a3a3c' }}>
      <div style={{ background: '#2c2c2e', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: '#0a84ff', fontFamily: UI.fontUi }}>Cancel</span>
        <span style={{ fontSize: 13, color: '#ebebf5', fontFamily: UI.fontUi, fontWeight: 600 }}>Add to Home Screen</span>
        <div style={{ background: 'var(--accent)', borderRadius: 6, padding: '3px 10px' }}>
          <span style={{ fontSize: 12, color: '#0a0805', fontFamily: UI.fontUi, fontWeight: 700 }}>Add</span>
        </div>
      </div>
      <div style={{ padding: '16px', background: '#2c2c2e', borderTop: '0.5px solid #3a3a3c', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
          <span style={{ fontSize: 24, fontWeight: 900, color: '#0a0805', fontFamily: UI.fontDisplay }}>Z</span>
        </div>
        <div style={{ background: '#3a3a3c', borderRadius: 8, padding: '5px 0', width: '60%', textAlign: 'center' }}>
          <span style={{ fontSize: 12, color: '#ebebf5', fontFamily: UI.fontUi }}>Zane</span>
        </div>
        <div style={{ fontSize: 10, color: '#8e8e93', fontFamily: UI.fontUi, textAlign: 'center', lineHeight: 1.4, maxWidth: 200 }}>
          An icon will be added to your Home Screen so you can quickly access this website.
        </div>
      </div>
    </div>
  );
}

// ─── PWA install visuals (Android) ──────────────────────────────────

function TourVisualPwaAndroidChrome() {
  return (
    <div style={{ background: '#202124', borderRadius: 8, overflow: 'hidden', border: '0.5px solid #3c4043' }}>
      <div style={{ background: '#292a2d', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, background: '#3c4043', borderRadius: 8, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
          <i className="fa-solid fa-lock" style={{ fontSize: 8, color: '#9aa0a6' }} />
          <span style={{ fontSize: 11, color: '#e8eaed', fontFamily: UI.fontUi, flex: 1 }}>zane-wo.com</span>
          <span style={{ fontSize: 9, color: '#9aa0a6', fontFamily: UI.fontUi, background: '#1a3a5c', padding: '2px 6px', borderRadius: 4 }}>Chrome</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '3px' }}>
          {[0,1,2].map(i => <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: '#9aa0a6' }} />)}
        </div>
      </div>
      <div style={{ padding: '10px 12px', background: UI.bgCard }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: '#0a0805', fontFamily: UI.fontDisplay }}>Z</span>
          </div>
          <span style={{ fontSize: 12, fontFamily: UI.fontUi, fontWeight: 600, color: UI.ink }}>ZANE</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {['TRAIN', 'PLAN', 'HEALTH'].map(t => (
            <div key={t} style={{ flex: 1, background: UI.bgInset, borderRadius: 4, padding: '5px 0', textAlign: 'center' }}>
              <span style={{ fontSize: 8, color: UI.inkFaint, fontFamily: UI.fontUi, letterSpacing: '0.06em' }}>{t}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TourVisualPwaAndroidMenu() {
  return (
    <div style={{ background: '#202124', borderRadius: 8, overflow: 'hidden', border: '0.5px solid #3c4043' }}>
      <div style={{ background: '#292a2d', padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, background: '#3c4043', borderRadius: 8, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
          <i className="fa-solid fa-lock" style={{ fontSize: 8, color: '#9aa0a6' }} />
          <span style={{ fontSize: 11, color: '#e8eaed', fontFamily: UI.fontUi }}>zane-wo.com</span>
        </div>
        <div style={{ padding: '5px 6px', borderRadius: 6, background: 'rgba(var(--accent-rgb),0.15)', border: '1.5px solid var(--accent)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {[0,1,2].map(i => <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--accent)' }} />)}
          </div>
        </div>
      </div>
      <div style={{ padding: '10px 12px', background: UI.bgCard, opacity: 0.4 }}>
        <div style={{ height: 44, background: UI.bgInset, borderRadius: 4 }} />
      </div>
    </div>
  );
}

function TourVisualPwaAndroidAddToHome() {
  const items = [
    { icon: 'fa-plus', label: 'New tab' },
    { icon: 'fa-mobile-screen-button', label: 'Add to Home screen', accent: true },
    { icon: 'fa-bookmark', label: 'Bookmarks' },
    { icon: 'fa-clock-rotate-left', label: 'History' },
  ];
  return (
    <div style={{ background: '#202124', borderRadius: 8, overflow: 'hidden', border: '0.5px solid #3c4043' }}>
      <div style={{ background: '#292a2d', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, background: '#3c4043', borderRadius: 8, padding: '5px 10px' }}>
          <span style={{ fontSize: 11, color: '#e8eaed', fontFamily: UI.fontUi }}>zane-wo.com</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '3px' }}>
          {[0,1,2].map(i => <div key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: '#9aa0a6' }} />)}
        </div>
      </div>
      <div style={{ background: '#292a2d', margin: '2px 4px 4px', borderRadius: 6, overflow: 'hidden', border: '0.5px solid #3c4043' }}>
        {items.map((item, i) => (
          <div key={item.label}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', background: item.accent ? 'rgba(var(--accent-rgb),0.12)' : 'transparent', borderLeft: item.accent ? '2.5px solid var(--accent)' : '2.5px solid transparent' }}>
              <i className={`fa-solid ${item.icon}`} style={{ fontSize: 12, color: item.accent ? 'var(--accent)' : '#9aa0a6', width: 14, textAlign: 'center' }} />
              <span style={{ fontSize: 12, color: item.accent ? 'var(--accent)' : '#e8eaed', fontFamily: UI.fontUi, fontWeight: item.accent ? 600 : 400 }}>{item.label}</span>
            </div>
            {i < items.length - 1 && <div style={{ height: 0.5, background: '#3c4043', marginLeft: 38 }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function TourVisualPwaAndroidInstall() {
  return (
    <div style={{ background: '#202124', borderRadius: 8, overflow: 'hidden', border: '0.5px solid #3c4043' }}>
      <div style={{ padding: '10px 12px', background: UI.bgCard, opacity: 0.35 }}>
        <div style={{ height: 44, background: UI.bgInset, borderRadius: 4 }} />
      </div>
      <div style={{ background: '#292a2d', margin: '0 8px 8px', borderRadius: 8, overflow: 'hidden', border: '0.5px solid #3c4043' }}>
        <div style={{ padding: '14px 16px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 38, height: 38, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 17, fontWeight: 900, color: '#0a0805', fontFamily: UI.fontDisplay }}>Z</span>
            </div>
            <div>
              <div style={{ fontSize: 13, color: '#e8eaed', fontFamily: UI.fontUi, fontWeight: 600 }}>Add Zane to Home screen?</div>
              <div style={{ fontSize: 10, color: '#9aa0a6', fontFamily: UI.fontUi, marginTop: 1 }}>zane-wo.com</div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 12px 12px' }}>
          <div style={{ padding: '6px 14px' }}>
            <span style={{ fontSize: 12, color: '#9aa0a6', fontFamily: UI.fontUi }}>Cancel</span>
          </div>
          <div style={{ padding: '6px 14px', borderRadius: 4, background: 'var(--accent)' }}>
            <span style={{ fontSize: 12, color: '#0a0805', fontFamily: UI.fontUi, fontWeight: 700 }}>Install</span>
          </div>
        </div>
      </div>
    </div>
  );
}

const TOUR_VISUALS = {
  days: TourVisualDays, exercises: TourVisualExercises, drag: TourVisualDrag,
  planLibrary: TourVisualPlanLibrary, planTemplates: TourVisualPlanTemplates,
  planFlexMeso: TourVisualPlanFlexMeso, planVersions: TourVisualPlanVersions,
  planBackups: TourVisualPlanBackups,
  trainOverview: TourVisualTrainOverview, trainWarmup: TourVisualTrainWarmup,
  trainLogSet: TourVisualTrainLogSet, trainKeyboard: TourVisualTrainKeyboard,
  trainPlates: TourVisualTrainPlates, trainSets: TourVisualTrainSets,
  trainNotes: TourVisualTrainNotes, trainNav: TourVisualTrainNav,
  trainSkip: TourVisualTrainSkip, trainEnd: TourVisualTrainEnd,
  trainFeel: TourVisualTrainFeel, trainWellDone: TourVisualTrainWellDone,
  trainIntensity: TourVisualTrainIntensity, trainMeso: TourVisualTrainMeso,
  trainSaveTemplate: TourVisualTrainSaveTemplate,
  quickActionsSwipe: TourVisualQuickActionsSwipe, quickActionsDailyLog: TourVisualQuickActionsDailyLog,
  quickActionsWorkout: TourVisualQuickActionsWorkout, quickActionsBacklog: TourVisualQuickActionsBacklog,
  quickActionsCardio: TourVisualQuickActionsCardio, quickActionsCheckin: TourVisualQuickActionsCheckin,
  quickActionsMessage: TourVisualQuickActionsMessage,
  healthLog: TourVisualHealthLog, healthWeek: TourVisualHealthWeek,
  cardioIntro: TourVisualCardioIntro, cardioActivity: TourVisualCardioActivity,
  cardioManual: TourVisualCardioManual, cardioGoal: TourVisualCardioGoal,
  cardioPreview: TourVisualCardioPreview, cardioActivate: TourVisualCardioActivate,
  statusIntro: TourVisualStatusIntro, statusDeload: TourVisualStatusDeload,
  statusNudge: TourVisualStatusNudge, statusSickVacation: TourVisualStatusSickVacation,
  customIntro: TourVisualCustomIntro, customAppearance: TourVisualCustomAppearance,
  customRest: TourVisualCustomRest, customEquipment: TourVisualCustomEquipment,
  customProgression: TourVisualCustomProgression, customPaceguard: TourVisualCustomPaceguard,
  healthCardio: TourVisualHealthCardio, healthEnable: TourVisualHealthEnable,
  coachEnable: TourVisualCoachEnable, coachRoles: TourVisualCoachRoles,
  coachInviteAccept: TourVisualCoachInviteAccept, coachCheckin: TourVisualCoachCheckin,
  coachMacros: TourVisualCoachMacros, coachNotes: TourVisualCoachNotes,
  coachInvite: TourVisualCoachInvite, coachClients: TourVisualCoachClients,
  coachTrends: TourVisualCoachTrends, coachSchema: TourVisualCoachSchema,
  coachSelf: TourVisualCoachSelf,
  pwaIosSafari: TourVisualPwaIosSafari, pwaIosShare: TourVisualPwaIosShare,
  pwaIosAddToHome: TourVisualPwaIosAddToHome, pwaIosAdd: TourVisualPwaIosAdd,
  pwaAndroidChrome: TourVisualPwaAndroidChrome, pwaAndroidMenu: TourVisualPwaAndroidMenu,
  pwaAndroidAddToHome: TourVisualPwaAndroidAddToHome, pwaAndroidInstall: TourVisualPwaAndroidInstall,
};

// ─── OnboardingPrompt ────────────────────────────────────────────────
function OnboardingPrompt({ onStart, onSkip }) {
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
        border: `1px solid ${UI.goldSoft}`,
        borderRadius: 6,
        padding: '32px 28px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: 12, textAlign: 'center',
        boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(var(--accent-rgb),0.2)',
        animation: 'fadeUp 0.3s ease',
      }}>
        <div style={{ width: 80, height: 80, marginBottom: 4, animation: 'logoPulse 2.4s ease-in-out infinite' }}>
          <img src="icons/zane-logo.png" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 28, color: UI.ink, fontWeight: 400, lineHeight: 1.1 }}>
          Welcome to ZANE
        </div>
        <div style={{ fontSize: 13.5, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.55 }}>
          Would you like a quick tour of the app?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', marginTop: 6 }}>
          <button onClick={onStart} style={{
            width: '100%', padding: '14px 0', borderRadius: 6,
            border: 'none', cursor: 'pointer',
            background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
            boxShadow: '0 8px 24px rgba(var(--accent-rgb),0.4)',
            color: '#0a0805', fontFamily: UI.fontUi, fontSize: 15, fontWeight: 700,
            letterSpacing: '0.06em', WebkitTapHighlightColor: 'transparent',
          }}>
            SHOW ME AROUND
          </button>
          <button onClick={onSkip} style={{
            width: '100%', padding: '12px 0', borderRadius: 6,
            border: `1px solid ${UI.hairStrong}`, cursor: 'pointer',
            background: 'transparent',
            color: UI.inkSoft, fontFamily: UI.fontUi, fontSize: 13, fontWeight: 500,
            WebkitTapHighlightColor: 'transparent',
          }}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── OnboardingTour ──────────────────────────────────────────────────
// Error boundary so the tour can NEVER white-screen / freeze the whole app.
// Any render error inside the tour (e.g. a misbehaving visual) is caught and
// turned into a dismissible "Close tour" card instead of crashing the root.
class TourBoundary extends React.Component {
  constructor(props) { super(props); this.state = { crashed: false }; }
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(err) { try { console.error('[tour] render error:', err); } catch (_) {} }
  render() { return this.state.crashed ? this.props.fallback : this.props.children; }
}

function TourCrashCard({ onClose }) {
  // This fallback shows only when a step crashed, so it is the least-exercised
  // path in the tour, yet its lone Close button used a plain onClick. That event
  // is dead on some devices (see the renderBtnRow note below), with no timer or
  // tap-anywhere behind it, so the user was trapped with no escape but killing
  // the app. Mirror TourCompleteScreen's guarantees: close on tap-anywhere, on
  // an onPointerDown button, and on a last-resort timer, so it can never hang.
  const doneRef = useRefOB(onClose);
  doneRef.current = onClose;
  const close = () => { try { doneRef.current && doneRef.current(); } catch (_) {} };
  useEffectOB(() => {
    const t = setTimeout(close, 6000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div onPointerDown={close} style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 320, background: UI.bgRaised,
        border: `1px solid ${UI.hairStrong}`, borderRadius: 6, padding: '24px 22px',
        display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'center',
      }}>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, fontWeight: 400 }}>Tour interrupted</div>
        <div style={{ fontSize: 13, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.5 }}>
          Something went wrong showing this step. Tap anywhere to close the tour and keep using the app.
        </div>
        <button onPointerDown={close} style={{
          padding: '13px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
          color: '#0a0805', fontFamily: UI.fontUi, fontSize: 14, fontWeight: 700, letterSpacing: '0.06em',
          WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
        }}>Close tour</button>
      </div>
    </div>
  );
}

// Flashy fullscreen "guide complete" celebration shown as the LAST step. It
// closes itself on a 3s timer (no button / onDone-via-tap dependency) and also
// on a tap anywhere — so reaching it always ends the tour, even if individual
// buttons misbehave. Kept deliberately simple (no heavy mockup) so its render
// can't hang.
function TourCompleteScreen({ title, onDone }) {
  const doneRef = useRefOB(onDone);
  doneRef.current = onDone;
  const close = () => { try { doneRef.current && doneRef.current(); } catch (_) {} };
  useEffectOB(() => {
    const t = setTimeout(close, 3000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div
      onPointerDown={close}
      style={{
        position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, bottom: 0, zIndex: 10000,
        background: 'linear-gradient(165deg, var(--accent-light) 0%, var(--accent) 48%, var(--accent-deep) 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 22, padding: 32, textAlign: 'center', animation: 'fadeUp 0.35s ease',
      }}>
      <div style={{
        width: 104, height: 104, borderRadius: '50%',
        background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'logoPulse 2.4s ease-in-out infinite',
      }}>
        <i className="fa-solid fa-trophy" style={{ fontSize: 46, color: '#0a0805' }} />
      </div>
      <div style={{ fontFamily: UI.fontDisplay, fontSize: 42, color: '#0a0805', fontWeight: 700, lineHeight: 1.04, letterSpacing: '0.02em' }}>
        {title || 'Guide Complete'}
      </div>
      <div style={{ fontFamily: UI.fontUi, fontSize: 14.5, color: 'rgba(10,8,5,0.78)', fontWeight: 600, letterSpacing: '0.03em', maxWidth: 300, lineHeight: 1.5 }}>
        You're all set — go crush your next session.
      </div>
    </div>
  );
}

function OnboardingTour(props) {
  return (
    <TourBoundary fallback={<TourCrashCard onClose={props.onDone} />}>      <OnboardingTourInner {...props} />
    </TourBoundary>
  );
}

function OnboardingTourInner({ tourKey, go, route, onDone }) {
  const steps = (window.TOURS || {})[tourKey] || [];
  const [stepIdx, setStepIdx] = useStateOB(0);
  // undefined = searching, null = no target (centered modal), DOMRect = found
  const [targetRect, setTargetRect] = useStateOB(undefined);
  const retryRef = useRefOB(null);

  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;

  useEffectOB(() => {
    clearTimeout(retryRef.current);
    if (!step) return;

    // Navigate if needed — wait for next effect run with updated route
    if (step.route && route.name !== step.route) {
      go({ name: step.route });
      setTargetRect(undefined);
      return;
    }

    // No spotlight target → centered modal
    if (!step.target) {
      setTargetRect(null);
      return;
    }

    // Find target in DOM with retries (allows for screen transitions).
    // `cancelled` + `cancelAnimationFrame` prevent a stale rAF callback from
    // firing after this effect re-runs (e.g. when the user advances to the next
    // step), which would overwrite the fresh targetRect with the old element's
    // rect and lock the tour in spotlight mode with no working buttons.
    setTargetRect(undefined);
    let cancelled = false;
    let rafId = null;
    let attempts = 0;
    let scrolled = false;
    const tryFind = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          // Pull the target into a comfortable band once, so both the spotlight
          // and its tooltip fit on screen — cards low on the Health screen would
          // otherwise sit half behind the nav bar. Fixed nav tabs don't scroll,
          // which is fine (their rect stays put).
          const vh = window.innerHeight;
          if (!scrolled && (r.top < 96 || r.bottom > vh - 200)) {
            scrolled = true;
            el.scrollIntoView({ block: 'center' });
            retryRef.current = setTimeout(tryFind, 140);
            return;
          }
          setTargetRect(r);
          return;
        }
      }
      attempts++;
      if (attempts < 30) { retryRef.current = setTimeout(tryFind, 80); }
      else { setTargetRect(null); }
    };
    rafId = requestAnimationFrame(tryFind);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      clearTimeout(retryRef.current);
    };
  }, [stepIdx, route.name]);

  const advance = () => {
    if (isLast) { onDone(); } else { setStepIdx(i => i + 1); }
  };
  const goBack = () => { if (stepIdx > 0) setStepIdx(i => i - 1); };

  if (!step) return null;

  // Final step → flashy auto-dismissing celebration instead of a normal modal
  // with an exit button. It closes on a 3s timer and on tap-anywhere, so the
  // tour always ends without depending on a single button working.
  if (isLast) return <TourCompleteScreen title={step.title} onDone={onDone} />;

  // Shared button row. IMPORTANT: this is a render *helper* called as a plain
  // function — never render it as <BtnRow/>. A component defined inside render
  // gets a new identity every render, so React would unmount/remount the button
  // subtree on each parent re-render (store sync, sync-status, realtime, …). A
  // tap whose pointerdown→click straddles such a remount is silently dropped —
  // that was the "visible buttons don't respond, must kill the app" bug.
  // Handlers fire on onPointerDown — NOT onClick. Proven this session: on this
  // device a plain onClick button (the plate-calculator key) was completely dead
  // while onPointerDown worked. The in-app keyboard uses the same pattern. Each
  // button has exactly one handler, so there is no double-fire.
  const tap = (fn) => (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
  const renderBtnRow = (compact) => (
    <div style={{ display: 'flex', gap: 8, marginTop: compact ? 0 : 4 }}>
      {stepIdx > 0 && (
        <button onPointerDown={tap(goBack)} style={{
          flex: '0 0 auto', padding: compact ? '9px 13px' : '11px 15px', borderRadius: compact ? 4 : 6,
          border: `1px solid ${UI.hairStrong}`, cursor: 'pointer',
          background: 'transparent',
          color: UI.inkFaint, fontFamily: UI.fontUi, fontSize: compact ? 12 : 14, fontWeight: 600,
          WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
        }} aria-label="Back">←</button>
      )}
      <button onPointerDown={tap(advance)} style={{
        flex: 2, padding: compact ? '9px 0' : '11px 0', borderRadius: compact ? 4 : 6,
        border: 'none', cursor: 'pointer',
        background: 'linear-gradient(160deg, var(--accent-light) 0%, var(--accent) 55%, var(--accent-deep) 100%)',
        boxShadow: `0 ${compact ? 4 : 6}px ${compact ? 14 : 20}px rgba(var(--accent-rgb),0.4)`,
        color: '#0a0805', fontFamily: UI.fontUi, fontSize: compact ? 11 : 13, fontWeight: 700,
        letterSpacing: '0.08em', WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation',
      }}>{isLast ? 'DONE' : 'NEXT →'}</button>
    </div>
  );

  const VisualComp = step.visual ? TOUR_VISUALS[step.visual] : null;

  // ── Centered (no target / fallback) → FULLSCREEN layout ──
  // These steps have no on-screen spotlight, so we use the whole screen instead
  // of a floating card: content scrolls in the middle, and the buttons are
  // pinned to the very bottom EDGE of the viewport — the most reliable place to
  // tap. No backdrop-filter, no card, no nested overlays.
  if (!step.target || targetRect === null) {
    return (
      <div style={{
        position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, bottom: 0, zIndex: 10000,
        background: 'var(--bg)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Scrollable content */}
        <div style={{
          flex: '1 1 auto', minHeight: 0, overflowY: 'auto',
          padding: '30px 26px 18px',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          <div className="micro-gold">{stepIdx + 1} / {steps.length}</div>
          <div style={{ fontFamily: UI.fontDisplay, fontSize: 30, color: UI.ink, fontWeight: 400, lineHeight: 1.08 }}>
            {step.title}
          </div>
          <div style={{ fontSize: 14, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.6, whiteSpace: 'pre-line' }}>
            {step.body}
          </div>
          {VisualComp && (
            <div style={{ marginTop: 4 }}>
              <TourBoundary fallback={null}><VisualComp /></TourBoundary>
            </div>
          )}
        </div>
        {/* Buttons pinned to the bottom edge of the screen */}
        <div style={{
          flexShrink: 0,
          padding: '14px 26px calc(env(safe-area-inset-bottom, 0px) + 20px)',
          borderTop: `0.5px solid ${UI.hair}`,
          background: UI.bgRaised,
        }}>
          {renderBtnRow(false)}
        </div>
      </div>
    );
  }

  // ── Brief loading state while navigating / searching ──
  if (targetRect === undefined) {
    return (
      <div style={{
        position: 'fixed', top: 'env(safe-area-inset-top, 0px)', left: 0, right: 0, bottom: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.35)',
      }} />
    );
  }

  // ── Spotlight mode ──
  const PAD = 10;
  const sx = Math.round(targetRect.left - PAD);
  const sy = Math.round(targetRect.top - PAD);
  const sw = Math.round(targetRect.width + PAD * 2);
  const sh = Math.round(targetRect.height + PAD * 2);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const TW = Math.min(300, vw - 32);
  const TOOLTIP_H = 178;
  const TIP_GAP = 14;

  // Tooltip X: center over spotlight, clamped to viewport
  // Exception: if spotlight is on the far left (sidebar), place tooltip to the right
  const nearLeft = sx + sw < vw * 0.3;
  let tipX, tipY;

  if (nearLeft) {
    tipX = Math.min(sx + sw + TIP_GAP, vw - TW - 8);
    tipY = Math.max(8, Math.min(sy + sh / 2 - TOOLTIP_H / 2, vh - TOOLTIP_H - 16));
  } else {
    tipX = Math.max(16, Math.min(sx + sw / 2 - TW / 2, vw - TW - 16));
    const canBelow = sy + sh + TIP_GAP + TOOLTIP_H < vh - 16;
    const forceTop = step.placement === 'top' || (!canBelow && sy > TOOLTIP_H + TIP_GAP + 8);
    if (forceTop) {
      tipY = Math.max(8, sy - TIP_GAP - TOOLTIP_H);
    } else {
      tipY = sy + sh + TIP_GAP;
      if (tipY + TOOLTIP_H > vh - 8) tipY = Math.max(8, vh - TOOLTIP_H - 8);
    }
  }

  return (
    <>
      {/* Full-screen intercept layer — blocks all taps reaching the app underneath */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 9995 }} />

      {/* Dark overlay via box-shadow (spotlight "hole") */}
      <div style={{
        position: 'fixed',
        left: sx, top: sy, width: sw, height: sh,
        borderRadius: 8,
        boxShadow: '0 0 0 9999px rgba(0,0,0,0.78)',
        zIndex: 9996,
        pointerEvents: 'none',
      }} />

      {/* Pulsing accent ring */}
      <div style={{
        position: 'fixed',
        left: sx, top: sy, width: sw, height: sh,
        borderRadius: 8,
        border: '2px solid var(--accent)',
        animation: 'tourRingPulse 1.8s ease-in-out infinite',
        zIndex: 9997,
        pointerEvents: 'none',
      }} />

      {/* Tooltip card */}
      <div style={{
        position: 'fixed',
        left: tipX, top: tipY, width: TW,
        background: UI.bgRaised,
        border: `1px solid ${UI.goldSoft}`,
        borderRadius: 6,
        padding: '16px 18px',
        display: 'flex', flexDirection: 'column', gap: 10,
        boxShadow: '0 16px 48px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(var(--accent-rgb),0.15)',
        zIndex: 9998,
        animation: 'fadeUp 0.2s ease',
      }}>
        <div className="micro-gold">{stepIdx + 1} / {steps.length}</div>
        <div style={{ fontFamily: UI.fontDisplay, fontSize: 22, color: UI.ink, fontWeight: 400, lineHeight: 1.1 }}>
          {step.title}
        </div>
        <div style={{ fontSize: 12.5, color: UI.inkSoft, fontFamily: UI.fontUi, lineHeight: 1.55, whiteSpace: 'pre-line' }}>
          {step.body}
        </div>
        {renderBtnRow(true)}
      </div>
    </>
  );
}

window.Screens = window.Screens || {};
Object.assign(window.Screens, { OnboardingPrompt, OnboardingTour });
