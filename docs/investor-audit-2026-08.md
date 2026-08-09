# INVESTOR AUDIT: Logbook / Zane (Training PWA)

**Audience:** Founder  
**Ton:** Due Diligence, nicht Höflichkeits-QA  
**Input:** 26 adversarisch verifizierte Findings (88 raw, 28 verified, 2 rejected, 0 unverified, 0 scan fails)  
**Stand:** 2026-08-09  

## 1. Investment Freeze-Frame

Zane ist eine ambitionierte All-in-one Training-PWA: Workout-Logging, Pläne/Mesocycles, Food, Health Daily Log, Medications, Cardio, Coaching, mit Supabase-Backend, Edge Functions und ernsthaften Engineering-Contracts (History-Windowing, `unwrap`/Retry, Backup-Coverage-CI). Das ist ungewöhnlich stark für eine No-npm, CDN-React-Codebase ohne klassischen Build-Step.

Was ungewöhnlich stark ist: Breite der Feature-Oberfläche, bewusste Domain-Contracts, Coaching als Business-Surface, Autoreg/Meso als Differenzierung, Food- und Meds-Tiefe jenseits typischer Gym-Logger.

Was scary ist: Zwei **Critical data-loss**-Pfade im Train- und Session-Lifecycle (Bodyweight+Load Keyboard korrumpiert Masse/e1RM/Volume/PRs; Auto-Close hard-deleted timed-out untracked Sessions **mit** realen Sets). Darunter ein High-Cluster, der Trust und Coaching-Job-to-be-done frisst: Sign-out wipe nach 5s-Timeout-als-Success, Boot-Merge schützt Plan-Pointer nur teilweise, Finish sealed pre-seeded Sets als done, Library Recent lügt "Nothing logged yet", Coach landet nach Plan-Edit auf blank UI und kann Clients über nicht-gespeicherte Pläne benachrichtigen. Parallel: PWA-only GTM, null Health/wearable-Pipeline, Food-Logging zu viele Taps. Das ist kein "junior QA style nits"-Report. Das ist Retention- und Trust-Risiko im Kernprodukt.

---

## 2. Executive Counts

| Metric | Value |
|--------|------:|
| Raw findings | 88 |
| Verified | 28 |
| Rejected after adversarial check | 2 |
| **Confirmed (this memo)** | **26** |
| Unverified | 0 |
| Scan failures | 0 |
| Domains scanned OK | 11 |

### By severity

| Severity | Count |
|----------|------:|
| **Critical** | **2** |
| **High** | **16** |
| **Medium** | **8** |
| Low | 0 |

### By category

| Category | Count |
|----------|------:|
| data-loss | 5 |
| competitive-gap | 7 |
| trust | 6 |
| ux-trap | 4 |
| bug | 4 |

### By domain (confirmed)

| Domain | Count |
|--------|------:|
| train-core | 5 |
| home-progress | 4 |
| food-nutrition | 4 |
| competitive-gaps | 2 |
| coaching-biz | 3 |
| health-body | 3 |
| plan-schedule | 3 |
| trust-store | 2 |
| backend-security | 1 |

---

## 3. Critical

### [data-loss] Bodyweight+load Keyboard re-applies total mass as belt load

- **File:** `src/screens-train.jsx`
- **Domain:** train-core
- **Issue:** Bei `plus_load` (Weighted Pull-ups, Dips, Belt Squats) seedet `activateKb` das kg-Feld mit `s.kg` (Gesamtmasse), während `weightPatch` / `kbApply` die getippte Zahl als Belt-Load interpretieren (`kg = base + typed`, `addedKg = typed`). `kbConfirm` re-applied immer den raw seed. Open-and-confirm auf einem seeded Set re-addiert Bodyweight (z.B. 80+20 gespeichert als 100 → `weightPatch(100)` → kg 180, addedKg 100). `kbAdjust` auf plain kg schreibt `{kg:next}` ohne `weightPatch`/`addedKg`.
- **Evidence:** `weightPatch` / `dispWeight` (≈1191–1198); `activateKb` field `kg` seeds `String(s.kg)` (≈4647–4649); `kbApply` kg-branch spreads `weightPatch(num)` (≈4790–4804); `kbConfirm` always `kbApply(kbRawRef.current)` then kg→reps (≈5035–5039); `kbAdjust` plain path `updateSession` writes `kg:next` / fill-down without `weightPatch` (≈4935–4955).
- **User impact:** Ein einziges Open-and-Confirm kann 80+ kg Phantom-Volume und false PRs erfinden. Power-User auf diesen Lifts verlieren nach einer Session das Vertrauen.
- **Why an investor cares:** Training-Core-Korruption ist product-death für Gym-Logger. Strong/Hevy leben von vertrauenswürdigen Zahlen. Ein viraler "my pull-ups show 180kg"-Post tötet Word-of-Mouth.
- **Suggestion:** `activateKb` muss von `dispWeight`/`addedKg` initialisieren; `kbAdjust` und fill-down müssen `weightPatch` rufen; Outlier-Checks Totals nach Patch vergleichen, nicht raw belt load.

### [data-loss] Auto-close hard-deletes untracked open sessions with real sets

- **File:** `supabase/functions/auto-close-sessions/index.ts`
- **Domain:** backend-security
- **Issue:** Nach Inactivity-Timeout wird jede offene Session, deren id **nicht** `settings.in_progress_session_id` ist, hard-deleted (`zane_sets`, `zane_session_entries`, `zane_sessions`) **ohne** `hasSets`-Guard. Der Client löscht nur leere Orphans und lässt Sessions mit Daten bewusst für Auto-Close **zum Beenden**, nicht zum Löschen. Multi-Device Re-Point von `in_progress_session_id` (im selben File anerkannt) lässt die vorige offene Session untracked und wipe-fähig.
- **Evidence:** Edge L127–134: if `!isTracked` → DELETE sets/entries/session, kein hasSets-Check (`hasSets` nur L109, L137+ für tracked). `store.js` L1473–1479: `orphanIds` nur bei `ended===null`, id ≠ in_progress, **und** keine entryRows **und** `exercise_count==0`; Kommentar L1463–1470: non-empty orphans bleiben für auto-close to **end**.
- **User impact:** Nutzer können ein ganzes Workout (inkl. PR-Historie dieser Session) verlieren, ohne Finish oder Delete. Gegen Strong/Hevy, wo incomplete Sessions closed oder kept werden, nicht silent erased: Retention-Kill und Support-Horror.
- **Why an investor cares:** Server-seitiger stiller Datenverlust ist die teuerste Bug-Klasse. Jeder Multi-Device-User ist in der Schusslinie. Das ist nicht "edge case UX", das ist Liability gegenüber jeder Power-User-Cohort.
- **Suggestion:** Untracked-but-hasSets: PATCH `ended`/`duration` wie tracked path, oder DELETE nur wenn `!hasSets`. Niemals Sessions mit realen Set-Rows hard-deleten.

---

## 4. High

### [data-loss] Boot merge schützt Plan/Status-Pointer nur teilweise

- **File:** `src/app.jsx`
- **Domain:** trust-store
- **Issue:** Base-Protect gilt nur für `activeScheduleId`, `cycleIndex`, `cycleStartDate`, `lastAdvancedDate` (+ `activeMealTemplateId`). `weekPlanStartDate`, `statusMode`, `statusModeSince`, `activeCardioPlanId`, `deloadPromptDismissedAt` kommen immer aus `...fresh`. `syncBase` wird auf pristine fresh gesetzt, bevor `setStore(merged)`: verworfene lokale Scalars matchen base und flushen nie. Weekday-Activate co-writes Plan-Id + `weekPlanStartDate` → Race kann Id behalten und Start-Date droppen; `statusMode` kann UI-Normal zeigen, während `statusPeriods` (direct-write, nicht syncStore) schon open period server-side hat.
- **Evidence:** `PLAN_POS_FIELDS`; mealPlanPosSrc only `activeMealTemplateId`; merged/syncBase pattern in `app.jsx`; Activate co-write in `screens-schedule.jsx`.
- **User impact:** Offline/Background-Race: Plan-Id sticky, Start-Date weg; Sick/Vacation UI lügt. Missed-day-Math, Deload, coach-visible Status falsch.
- **Why an investor cares:** Multi-Device + Offline ist Table-Stakes-Trust. Falsche Status- und Plan-Position sind stille Logikfehler über Wochen, nicht ein Screen-Glitch.
- **Suggestion:** `weekPlanStartDate` in Plan-Position-Tuple; base-aware Rule wie water/plan für statusMode/statusModeSince/activeCardioPlanId/deloadPromptDismissedAt; `statusPeriods` mit Collection-Guard mergen.

### [competitive-gap] Keine Apple Health / Health Connect / Wearable-Pipeline

- **File:** `src/` (repo-wide)
- **Domain:** competitive-gaps
- **Issue:** Zero Matches für HealthKit, Apple Health, Google Fit, Health Connect, Garmin, Fitbit, Strava, Web Bluetooth. Weight, Steps, sleep-adjacent Metrics nur manuelle Daily-Log-Felder. `library.auto-pull-bodyweight-from-health` liest `latestBodyweight()` aus `store.dailyLogs`, nicht aus Scale/OS.
- **Evidence:** grep 0 hits; `screens-health.jsx` BODY `numField('weight'|'steps')`; feature-map health.daily-log; Sleep nur subjective 1–10 Check-in.
- **User impact:** Switcher von MacroFactor, Strong, Hevy, Whoop/Apple-Watch-Stacks double-entern täglich. Nutrition/Health-Hälfte des All-in-one-Pitches wirkt incomplete.
- **Why an investor cares:** Marketing verkauft Health-Säule; ohne Sensor-Pipeline ist das Feature-Map-Storytelling, kein Moat. Severity high (nicht critical): reines PWA ohne native Shell kann HealthKit/Health Connect strukturell nicht hosten; Train-Core bleibt nutzbar.
- **Suggestion:** Thin native shell (Capacitor/TWA) first: weight, steps, workout write-back.  
- **competitor_ref:** MacroFactor (Apple Health / Google Fit), Strong/Hevy Health integrations, Apple Fitness / Garmin Connect

### [competitive-gap] PWA-only: kein App Store / Play, kein Watch

- **File:** `welcome.html` (+ manifest, feature-map, onboarding)
- **Domain:** competitive-gaps
- **Issue:** Distribution ist browser/PWA only. Install = multi-step Add to Home Screen. Kein App-Store/Play-Listing, kein Apple Watch / Wear OS / Complication / Live Activity Surface. Bewusst vermarktet ("No app store, no download").
- **Evidence:** welcome.html A2HS Copy; `manifest.json` display standalone; feature card `start.install-as-an-app`; onboarding "no App Store needed"; grep WatchOS/Wear OS/Live Activity: keine Treffer.
- **User impact:** Mainstream-Acquisition stirbt vor Product-Quality: Store-Search, Ratings, "is this a real app?". Gym-floor Watch-Logging (Hevy/Strong) unmöglich; Phone-unlock bleibt einziger Logging-Pfad.
- **Why an investor cares:** GTM-Ceiling. Du kannst nischenstark sein; du kannst nicht ehrlich mit store-native Peers um denselben Funnel kämpfen, ohne Store-Wrapper oder bewusste Niche-Only-These im Deck.
- **Suggestion:** Web core behalten, wrap für Store + Watch companion (set complete / rest timer). Oder Niche-Ceiling akzeptieren und Peer-Vergleiche im Investor-Deck stoppen.  
- **competitor_ref:** Strong, Hevy, JuggernautAI (App Store + Watch); TrainHeroic / RP store-native

### [data-loss] Sign-out: 5s flush timeout gilt als Success, dann Local Wipe

- **File:** `src/app.jsx`
- **Domain:** trust-store
- **Issue:** `flushBeforeSignOut` raced `syncStore` gegen 5s-Timer ohne Winner-Flag. Timeout oder Sync-Error returnt trotzdem success → intentional SIGNED_OUT → `LB.clearLocal` + pending/syncBase null. Einzige Retry-Quelle tot. Export warnt bei unsynced; Sign-out nicht.
- **Evidence:** app.jsx ≈855–868 Promise.race; ≈846–854 comments SIGNED_OUT wipes pending; ≈1284–1317 intentional arm → clearLocal; store.js clearLocal removes `logbook-${userId}` / base; settings: markIntentionalSignOut → flush → signOut, no post-flush pending check.
- **User impact:** Sign-out nach slow network / mid-workout finish: last sets, cycle advance, macros nie auf Supabase, kein Retry nach Login.
- **Why an investor cares:** Competitors blocken Sign-out oder halten Offline-Queue bis Cloud-Ack. Das hier ist self-inflicted data loss auf dem "I am leaving"-Pfad.
- **Suggestion:** Intentional wipe nur nach confirmed `syncBase`-Advancement; bei Timeout Sign-out verweigern oder involuntary-preserve + "unsynced changes" Blocker.  
- **competitor_ref:** Strong / Hevy keep offline queue until cloud ack; no wipe on logout when sync pending

### [trust] Finish seals pre-seeded unticked sets as done

- **File:** `src/screens-train.jsx`
- **Domain:** train-core
- **Issue:** Finish-Sheet listet `!done && !skipped` als Incomplete. `finish()` wendet `sealDoneSets` an: hat die Exercise mind. ein done Set und offene Sets haben kg/reps, werden sie `done:true`. `buildSeedSets` prefilled genau diese Werte mit `done:false`. Skip-remaining ist der korrekte incomplete-Pfad; Finish nutzt ihn nicht für partial exercises. Progression/Meso filtert auf `st.done` und inkludiert sealed Sets.
- **Evidence:** sealDoneSets ≈2394–2414; finish ≈2425; Incomplete UI ≈7739–7754; buildSeedSets store.js ≈3369–3399; progression/meso require `st.done`.
- **User impact:** User lässt Sets bewusst unchecked (failed lift, cut short, skip backoff). App logged seed numbers als completed. Volume, History, Progression, Meso grades inflate. App "rewrote the workout".
- **Why an investor cares:** Silent rewrite of user intent is worse than a crash. Trust in progression systems dies first.
- **Suggestion:** Nur sealen mit explizitem Opt-in (Check remaining), oder valued open sets als skipped; nie auto-done gegen die Incomplete-Liste.

### [ux-trap] Rest timer auto-opens full-screen sheet at zero

- **File:** `src/screens-train.jsx`
- **Domain:** train-core
- **Issue:** `fireRestDone` öffnet Rest Sheet bei normalem Rest-Expiry (nach session `startedAt`), full-viewport blocking backdrop zIndex 100 über CustomKeyboard zIndex 95, plus Flash/Beeps. Header RestGauge ist bereits non-blocking.
- **Evidence:** ≈4390–4406 auto-open; timeout arm ≈4470–4479; Rest Sheet ≈8763–8801; RestGauge ≈6349–6356; Sheet default z 100 vs keyboard 95.
- **User impact:** Strong/Hevy halten Rest non-blocking, damit man während Rest tippt. Hier stiehlt Expiry Focus während Keyboard/Row aktiv. Extra Dismiss pro Set → angry power users.
- **Why an investor cares:** Logging speed is the retention moat of gym apps. Every forced dismiss is measurable friction on the hottest path.
- **Suggestion:** Default header flash + sound + optional push; Modal nur on tap oder Settings opt-in intrusive.

### [ux-trap] Meso/Autoreg erzwingt multi-sheet Questionnaire mid-workout

- **File:** `src/screens-train.jsx`
- **Domain:** train-core
- **Issue:** Bei `mesoActive`: Readiness auto-open on mount (unleavable `onClose={()=>{}}`); Soreness first muscle; Joint/pump/affinity after working sets, kann Volume-Sheet cascaden; Finish deferred solange Sheets open; Progression toast suppressed. Opt-in meso und On-point one-tap mildern Breadth, nicht Interrupt für diese User.
- **Evidence:** readiness ≈857–914, ≈5917–5949; soreness/joint/volume cascade ≈4251–4373, ≈3757–3796; onClose no-ops ≈9033/9072/9160; requestFinishOpen defer ≈2779–2782.
- **User impact:** Vs Strong/Hevy/TrainHeroic: set logging interrupted by coaching interviews. Paying power users, die RPE later wollen, fühlen sich verlangsamt und belehrt.
- **Why an investor cares:** Autoreg is differentiation; mid-set interrogation is conversion poison for non-RP converts. Feature must not eat the logging loop.
- **Suggestion:** One-tap defaults, batch feedback at end, oder Train now / Review later; nie Sheets unter Rest/Finish ohne Escape stacken.

### [trust] Library Recent treats windowed sessions as first-run empty

- **File:** `src/screens-lib.jsx`
- **Domain:** home-progress
- **Issue:** Default-Tab Recent indexiert Exercises nur via `s.entries.forEach`. Windowed Sessions haben `entries:[]` + aggregates. Nach Break >70 Tage / reinstall / device ohne cached entries: `recent=[]`, Empty "Nothing logged yet". History im selben File nutzt bereits `s.entries.length || s.aggExercises`.
- **Evidence:** `_lib.tab: 'recent'`; recent useMemo ≈226–244; Empty ≈405–407; HISTORY_WINDOW_DAYS=70 store.js; mapEntryRows/agg* ≈1507–1516; History row ≈2929 contrast.
- **User impact:** Returning user mit Monaten History wird gesagt, nichts geloggt. Data-gone Feeling, obwohl History Sessions via Aggregates listet.
- **Why an investor cares:** Re-activation moment is when churn decides. False first-run empty is a trust failure, not a missing list item.
- **Suggestion:** Recent aus session metadata + exercise history/exerciseBests; nie "Nothing logged yet" wenn ended sessions existieren; lazy-fetch last two per exId wie Home.

### [ux-trap] History → Cardio empty state is a dead end

- **File:** `src/screens-lib.jsx`
- **Domain:** home-progress
- **Issue:** Empty sagt "Tap the button above…", aber TopBar-right ist nur auf Workouts (Filter); `setCardioLogOpen(true)` nur vom Edit-Pencil existierender Logs. Sheet ist create-fähig mit `editLog=null`, wird hier nie so geöffnet. Home/onboarding haben echte Create-Pfade.
- **Evidence:** Empty ≈2968; TopBar ≈2834–2845; sole open with edit ≈3007; CardioQuickLogSheet ≈3020–3026.
- **User impact:** Wer Cardio unter History sucht (reasonable nach Hevy/Strong) kann von dort nicht loggen. Empty gaslighted. Onboarding und History widersprechen sich.
- **Why an investor cares:** Gaslighting empty states train users to distrust the product UI copy everywhere.
- **Suggestion:** Log-cardio Control auf Cardio-Tab + Empty action → `CardioQuickLogSheet` mit `editLog=null`.

### [ux-trap] Meds Timeline empty points to wrong create surface

- **File:** `src/screens-medications.jsx`
- **Domain:** health-body
- **Issue:** Timeline empty (default tab): "Add a medication in the Schedule tab…". Create existiert nur Inventory → Medications (`openMedSheet(null)`). Schedule plan Add nur attach existing. Plan empty sagt sogar "already created in the Medications tab."
- **Evidence:** L1587–1588; L1830–1838; L919–921 / L1995–2005; L1765.
- **User impact:** First-time Meds: Timeline → Schedule → Plan ohne Med-Identity → Feature wirkt broken → bounce.
- **Why an investor cares:** Meds is a differentiation pillar. First-session dead end = feature tax without retention payoff.
- **Suggestion:** Timeline empty auf Inventory → Medications (deep-link / open Add sheet). Alle Empty-Copy an real create surface alignen.

### [competitive-gap] Steps/body metrics pure manual entry

- **File:** `src/screens-health.jsx`
- **Domain:** health-body
- **Issue:** Steps als text/decimal field; save `healthInt(form.steps)`; charts from dailyLogs. Keine Phone-Sensor / Health-Platform APIs in src/.
- **Evidence:** BODY numField steps; stepsSeries/HealthBarChart; feature-map daily-log; grep no pedometer/HealthKit/etc.
- **User impact:** Daily step goals sind Default-Habit-Loop bei MacroFactor/MFP. Manual typing kills adherence; Health fühlt sich wie Homework an.
- **Why an investor cares:** Same strategic hole as Health pipeline; steps are the cheapest passive win once a native shell exists.  
- **Suggestion:** Passive phone step pull (oder Health Connect / Apple Health read) into `dailyLogs.steps` mit Consent + Conflict rules.  
- **competitor_ref:** MacroFactor, MyFitnessPal, Apple Health / Health Connect auto steps

### [bug] Recipe log always exposes "Plan it" when Plan Mode off

- **File:** `src/screens-food.jsx`
- **Domain:** food-nutrition
- **Issue:** Main recipe footer rendert immer Plan it → `confirmRecipeLog(true)` ohne `planMode`-Guard. Sibling paths (cooking, qty, custom, meal) gaten korrekt. Verletzt Invariant: planMode off ⇒ never planned. Planned rows excluded from dayTotals/patchDaily/adherence; ohne planMode keine Checkbox / Logged-Planned Switch → stuck planned.
- **Evidence:** footer ≈6069–6081 vs cooking ≈6058–6067; stages planned ≈4230; patchDaily sums `!e.planned` ≈2591–2594; claims ≈1889–1891; FdCheckbox only if planMode ≈4975–4977.
- **User impact:** User tippt Plan it (denkt normal add), Food muted/dashed, Macros/Adherence ignore it, kein Check-off. App "ate dinner calories". Coaching totals und Health day score undercount.
- **Why an investor cares:** Silent calorie undercount is a nutrition-product trust killer. One bad dinner ruins the day score story.
- **Suggestion:** Gate Plan it on planMode; if !planMode force `planned:false` on commit and edit save.

### [competitive-gap] Food re-log is multi-step staged batch, no one-tap

- **File:** `src/screens-food.jsx`
- **Domain:** food-nutrition
- **Issue:** Favorites/Recents: row → qty sheet → Add/Log it → docked Add (min. 3 taps). Kein one-tap last amount. Absolute "every path" ist overstated (Repeat Yesterday, Meal of Choice, in-place edit, templates write differently), aber staple re-log aus Quick Add fehlt.
- **Evidence:** stage-only architecture comments ≈2650–2653, ≈3517–3519; reAddFromRecent ≈3263–3264; confirmLogFood stages only ≈3561–3582; dock commit ≈4490–4491; Recent/Favorites rows ≈5229/5256.
- **User impact:** Heavy daily nutrition users fühlen sich langsamer als MFP/MacroFactor. Extra steps + second Add → abandoned picks + Discard dialogs.
- **Why an investor cares:** Nutrition retention is logging speed. Multi-tap staple re-log is a structural tax on the monetizable habit.  
- **Suggestion:** Quick-log: long-press or + on recent/favorite commits last qty immediately; keep staging for multi-item.  
- **competitor_ref:** MacroFactor / MyFitnessPal quick add and recent re-log

### [bug] Coach plan create/edit navigates to blank client page

- **File:** `src/screens-coaching-detail.jsx` (+ client.jsx)
- **Domain:** coaching-biz
- **Issue:** Navigation returns `initialTab: 'plan'`, aber `CoachClientScreen` top-level tabs sind nur overview|daily|sessions|setup|notes|checkins. `plan` ist nur Sub-Tab unter setup. Kein Remap → blank body, no tab selected.
- **Evidence:** detail ≈2140/2178/2219 go initialTab plan; client L6 useStateC(initialTab||'overview'); L85–92 / L159–166 tabs; L1109–1115 plan as setup sub only; app.jsx passes route.initialTab without rewrite.
- **User impact:** Jeder Plan create/edit endet in dead UI. Coach denkt Save vanished, muss Setup jagen. High daily friction auf core coaching job.
- **Why an investor cares:** If B2B/coaching is revenue path, this is a broken post-save loop on the money surface. Ship-stopper for coach pilots.
- **Suggestion:** Navigate `initialTab: 'setup'` (+ optional sub-tab), oder map legacy `'plan'` → setup.

### [trust] Coach plan exit posts "Updated plan" even when sync failed

- **File:** `src/screens-coaching-detail.jsx`
- **Domain:** coaching-biz
- **Issue:** `setClientStore` optimistic commit; `syncErr` nur in catch. `coachGo` posts Updated plan note from local `latestClientStore` when dirty, **ohne** syncErr check / await pending. Pill is display-only ("Change not saved, keep editing to retry").
- **Evidence:** useCoachClientSync ≈2119–2127; coachGo ≈2159–2178; CoachSyncErrorPill display-only.
- **User impact:** Client notified that program changed while server still has old plan. Plan ownership trust dies.
- **Why an investor cares:** False client notifications on the most sensitive coaching surface = churn for both sides of the marketplace.
- **Suggestion:** Block exit while syncErr; retry pending before notes; notify only after confirmed write.

### [competitive-gap] Coach invite is email-only against existing accounts

- **File:** `src/screens-coaching-tabs.jsx`
- **Domain:** coaching-biz
- **Issue:** `inviteClient(email)` → RPC `invite_client` → find existing auth user or `ERROR:not_found`. Copy: must already have account. Accept only in-app pending banner. No invite link, QR, magic code, pre-account onboarding.
- **Evidence:** tabs L168–180, L257–258; store inviteClient; schema invite_client; CoachingPendingBanner; feature-map invite-and-manage-clients; grep no coaching QR/link/code.
- **User impact:** Coaches cannot onboard cold athletes like TrueCoach/TrainHeroic. Growth and trial conversion stall at first invite.
- **Why an investor cares:** Coaching GTM bottleneck is structural. You cannot scale coach acquisition if every client must self-register first.  
- **Suggestion:** Shareable invite links (deep link welcome/signup + coach token) + pending invites for unknown emails.  
- **competitor_ref:** TrueCoach / TrainHeroic invite links and email onboarding without pre-existing accounts

---

## 5. Medium

### [trust] Macro adherence is symmetric |error|, red under 75%

- **File:** `src/store.js` (+ screens-health, coaching-core)
- **Domain:** health-body
- **Issue:** `macroAdherence` = kcal-weighted symmetric |actual-target|/target; UI <75 danger + OFF TRACK; check-in higher_better. Intentional surplus/refeed against cut targets can paint as failure. Milder: MoC/status unscored; kcal weighting braucht große multi-macro misses für deep red.
- **User impact:** Moralizing red after solid high-protein day → distrust ring or game MoC.  
- **Suggestion:** Soft floors (protein ≥ target full credit), calorie bands, or split hit-protein vs hit-calories.  
- **competitor_ref:** MacroFactor adherence / RP-style bands

### [bug] Library Recent trend e1RM includes warm-ups

- **File:** `src/screens-lib.jsx`
- **Domain:** home-progress
- **Issue:** Trend `e1rm()` Math.max over all sets, no warmup/skipped filter; caption deliberately working-set only. Mismatch vs `bestE1rmForExercise` / chart valForSet. Max e1RM oft ignore lighter warmups; skipped/prefilled pollution realistischer.
- **User impact:** ↑/↓ ungleich kg×reps caption; feels broken next to Strong/Hevy working-set trends.  
- **Suggestion:** Mirror Home currWorking/prevWorking filters before max e1RM.

### [bug] Session detail set-vs-last-time skips windowed priors

- **File:** `src/screens-lib.jsx`
- **Domain:** home-progress
- **Issue:** `prevEntryMap` `.find` on entries with data; windowed priors (`entries:[]`, aggExercises>0) skipped. SessionDetail fetches only current sessionId; Home already queues `neededPriorSessionIds`. Bites after 70+ days / sparse gaps / older review.
- **User impact:** Hide real improvements, invent declines, miss PR stars vs true previous same-day session.  
- **Suggestion:** Reuse Home neededIds; gate isImprovement/isDecline until hydrated.

### [competitive-gap] Barcode weak on installed iOS PWAs

- **File:** `src/screens-food.jsx`
- **Domain:** food-nutrition
- **Issue:** FdScanner documents iOS standalone getUserMedia as unfixable from here; OFF-only barcode (USDA no barcode API); fallbacks: type EAN, label OCR, name search. Real gap vs native barcode UX; not daily-habit-kill everywhere dank Fallbacks.
- **User impact:** Fridge scan fails → type EAN or abandon.  
- **Suggestion:** First-class type-barcode field; Safari-tab deep link if standalone fails; native wrapper later.  
- **competitor_ref:** MyFitnessPal / Cronometer barcode UX

### [trust] Save as favorite can silently no-op on cache failure

- **File:** `src/screens-food.jsx`
- **Domain:** food-nutrition
- **Issue:** `toggleFavorite` returns on `!ensureFoodCached` without error UI; star stays hollow (kein false "saved"). Narrow path (uncached DB foods). Missing failure feedback, not optimistic lie.
- **User impact:** User expects staple saved; next session missing if they didn't notice hollow star.  
- **Suggestion:** Toast on cache failure; optional name-only favorite.

### [data-loss] Cycle/Flex → Weekday hard-clears days (after confirm)

- **File:** `src/screens-schedule.jsx`
- **Domain:** plan-schedule
- **Issue:** switchMode after danger confirm sets `days:[]`; templates ship as flex (`instantiateProgram` / programs-db). Intentional weekday-empty design; reverse path preserves; exercises remain in library; flex already models M/W/F. Overstated as silent data-loss.
- **User impact:** User picks template then fixed weekdays (Strong/Hevy mental model) → rebuild every session. Feels like plan eaten.  
- **Suggestion:** Map days onto weekdays or convert wizard; template instantiate choose mode.  
- **competitor_ref:** Hevy / Strong

### [trust] Plan-editor autosave pure LWW, weak conflict UX

- **File:** `src/store.js` (+ screens-schedule)
- **Domain:** plan-schedule
- **Issue:** `zane_plan_drafts` PK upsert LWW, no updated_at guard; merge max(updatedAt); silent restore; no draft age/TTL. Resume/Discard exists ("no conflict UI" overstated). Drafts decoupled from committed schedules; coach drafts owner-isolated. Concurrent same-user uncommitted clobber, not stranger theft.
- **User impact:** Phone + tablet overwrite each other silently; hard to tell which device won.  
- **Suggestion:** Show updatedAt/device; prompt when both dirty; expire stale drafts after N days.  
- **competitor_ref:** TrainHeroic multi-device plan editing expectations

### [competitive-gap] ExercisePicker hides system catalog until search/muscle filter

- **File:** `src/screens-schedule.jsx`
- **Domain:** plan-schedule
- **Issue:** `dbActive = !!q || filterTags.length > 0`; else systemList `[]`. Empty library: "No exercises found" + tip. MUSCLES pills always visible (one tap activates DB). Library has browsable Database tab; templates seed catalog. Discoverability gap, not hard block.
- **User impact:** Custom builders with empty library feel dumb vs competitors' immediate DB browse.  
- **Suggestion:** Show popular catalog rows by default or expand DATABASE when `store.exercises` empty.  
- **competitor_ref:** Hevy / Strong / Juggernaut

---

## 6. Low

Keine bestätigten Low-Findings in diesem Durchlauf.

---

## 7. Competitive Gaps Board

Cluster der product holes und competitive-gap Findings. Was Geld **zuerst** kaufen sollte:

| Gap | Severity | Money priority | Rationale |
|-----|----------|----------------|-----------|
| **Trust/data-loss core (Criticals + sign-out + boot merge + finish seal)** | C/H | **P0 now** | No growth spend until logging numbers and sessions are sacred |
| **Coaching loop (blank tab + false Updated plan + invite-only existing users)** | H | **P0 if coaching is GTM** | Broken post-save + cannot onboard cold clients = no coach pipeline |
| **Food logging speed (one-tap re-log) + Plan-it invariant** | H | **P1** | Nutrition half of all-in-one pitch; habit loop tax |
| **Train UX (rest non-blocking, meso feedback batching)** | H | **P1** | Power-user logging speed vs Strong/Hevy |
| **Windowing honesty (Recent empty, session detail priors, trend warmups)** | H/M | **P1** | Returning users must never see false first-run |
| **Empty-state integrity (Cardio History, Meds Timeline)** | H | **P1 cheap** | Copy/wire fixes, high trust ROI per hour |
| **Native shell: HealthKit/Health Connect weight+steps** | H | **P2 capital** | Unlocks passive health pillar; PWA cannot |
| **Store distribution + Watch companion** | H | **P2 capital** | Mainstream acquisition + gym-floor logging |
| **Barcode reliability (iOS standalone)** | M | **P2 with shell** | Native camera after wrapper; typed EAN first |
| **Plan mode convert + ExercisePicker default catalog** | M | **P2 polish** | First-session custom plan discoverability |
| **Macro adherence bands** | M | **P3** | Scoring philosophy, not ship-blocker |
| **Plan draft conflict age/TTL** | M | **P3** | Multi-device power users only |

**What money should buy first (capital allocation):**

1. **Engineering focus 30 days, zero feature expansion:** Critical deletes/corruption + High data-loss/trust on train/sync/coaching. These are not "roadmap themes"; they are investability gates.
2. **Then habit speed:** Food one-tap + rest non-blocking + empty-state fixes. Cheap, retention-positive.
3. **Then GTM architecture capital:** Capacitor/TWA (or similar) for store listing + Health read + later Watch. Without this, Health/steps/barcode/Watch gaps remain structural.
4. **Coaching GTM:** Invite links for unknown emails before scaling coach sales.

Do not fund feature breadth until Criticals are dead. Breadth without sacred session data is a museum of screens.

---

## 8. What I would change before writing a check

Prioritized 10 actions (product + eng). No polite backlog padding.

1. **Ship-stopper fix: `plus_load` keyboard path** (`activateKb` from dispWeight/addedKg; kbAdjust/fill-down via weightPatch; outlier on totals). Regression tests on weighted pull-up open-confirm and stepper.
2. **Ship-stopper fix: auto-close** never DELETE when hasSets; close like tracked path. Align edge comment with client orphan policy. Multi-device in_progress re-point scenario in tests.
3. **Sign-out integrity:** No intentional local wipe until syncBase advanced; timeout blocks sign-out or preserves involuntary path with explicit unsynced UI.
4. **Boot merge:** Protect `weekPlanStartDate` with plan tuple; base-aware statusMode/statusModeSince/activeCardioPlanId/deloadPromptDismissedAt; statusPeriods collection merge.
5. **Finish honesty:** sealDoneSets only with explicit user choice matching Incomplete list; never auto-done seeded open sets.
6. **Coaching daily loop:** remap `initialTab: 'plan'` → setup; block exit + notes while syncErr; notify only after confirmed write.
7. **Coach acquisition:** pending invite + shareable deep link for emails without accounts.
8. **Food Plan-it gate + one-tap favorite/recent re-log** (long-press or + commits last qty).
9. **Train friction cut:** rest expiry non-blocking by default; meso feedback batch/end or escape hatch.
10. **Windowing UI honesty:** Library Recent never "Nothing logged yet" with ended sessions; SessionDetail hydrate windowed priors like Home; Recent trend exclude warmup/skipped.
11. **Empty-state truth:** Cardio History Log button; Meds Timeline → real create surface.
12. **Strategic memo for board (not code):** Accept PWA niche ceiling **or** fund native shell + store + Health in 2H. Stop deck comparisons that imply parity with Strong/Hevy/MacroFactor distribution and sensors until that check is cashed.

---

## 9. Residual Risk

| Bucket | Count | Investor read |
|--------|------:|---------------|
| Confirmed (in memo) | 26 | Actionable, code-backed |
| Verified then rejected (adversarial) | 2 | Noise filtered; good process hygiene |
| Unverified | 0 | No hanging "maybe" liabilities in this package |
| Scan failures | 0 | Domain coverage completed (11 scan_ok) |
| Raw not promoted | 88−26 = 62 discarded/downscoped before confirm | Expect more medium nits in future passes; not in this investment freeze-frame |

**Process note:** Severity was adversarially cut on several items (Health/PWA from critical→high; macro/trend/session-detail/barcode/favorite/weekday-wipe/plan-LWW/picker from high→medium). That discipline matters: this memo is not inflated for drama. The two Criticals survived that filter for a reason.

**Outside this package (known architectural residual, not re-invented as findings):** pure PWA cannot close HealthKit/Watch without capital and native work; History-Windowing itself is intentional (bugs are UIs that ignore aggregates); coaching invite design is product policy until links ship.

---

## 10. investment_verdict

Heute: **kein unbedingter Check.** Die Codebase zeigt echte Produktambition (Train + Food + Health + Meds + Coaching + Autoreg in einer PWA, CI-Gates, History-Windowing, RLS-Bewusstsein), aber zwei bestätigte data-loss Criticals und ein Cluster aus Sign-out-Wipe, Boot-Merge-Partial-Pointer und silent Finish-Seal sind genau die Klasse Bugs, die Power-User und Coaches unwiderruflich verlieren. Competitive Gaps (kein App Store, kein HealthKit/Health Connect, kein Watch, Coach-Invite nur für bestehende Accounts) sind strategisch, nicht peinlich, solange du sie nicht gegen Strong/Hevy/MacroFactor in Decks als gleichwertig verkaufst. **Investition conditional:** (1) Criticals und die High data-loss/trust-Pfade im Train/Sync/Coaching-Kern geschlossen und mit Regressionstests abgesichert, (2) messbare Retention auf Logging-Speed (Food one-tap, Rest non-blocking), (3) klarer 6–12-Monats-Plan nativer Shell + Health-Read + Invite-Links. Ohne (1) ist jedes Growth-Dollar teure Akquise für churn-by-trust.


---

## Investment verdict

Heute: kein unbedingter Check. Die Codebase zeigt echte Produktambition (Train + Food + Health + Meds + Coaching + Autoreg in einer PWA, CI-Gates, History-Windowing, RLS-Bewusstsein), aber zwei bestätigte data-loss Criticals und ein Cluster aus Sign-out-Wipe, Boot-Merge-Partial-Pointer und silent Finish-Seal sind genau die Klasse Bugs, die Power-User und Coaches unwiderruflich verlieren. Competitive Gaps (kein App Store, kein HealthKit/Health Connect, kein Watch, Coach-Invite nur für bestehende Accounts) sind strategisch, nicht peinlich, solange du sie nicht gegen Strong/Hevy/MacroFactor in Decks als gleichwertig verkaufst. Investition conditional: (1) Criticals und die High data-loss/trust-Pfade im Train/Sync/Coaching-Kern geschlossen und mit Regressionstests abgesichert, (2) messbare Retention auf Logging-Speed (Food one-tap, Rest non-blocking), (3) klarer 6–12-Monats-Plan nativer Shell + Health-Read + Invite-Links. Ohne (1) ist jedes Growth-Dollar teure Akquise für churn-by-trust.
