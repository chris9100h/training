# Ship-Review vs main

Branch: `codex/friends-social-preview`  
Basis: `origin/main`  
Datum: 2026-08-13  
Methode: Workflow `review-vs-main` (8 Area-Reviews, danach fail-closed verifiziert)

## Urteil

**do-not-ship.** Der Branch bringt einen opt-in Friends-Preview (Circle, Chats, Gruppen, Metric Sharing, Plan-Snapshots, Live-Workout-Feed/Cheers) plus Food-Day-Closed und den X-Handle-Prompt. Das ist als Preview hinter `showFriendsTab` (Default false) gedacht, der aktuelle Stand verletzt diesen Vertrag aber schon für normale Trainings-User und hat mehrere Privacy-Löcher, die ein Friend oder ein authenticated Client direkt ausnutzen kann. Vor einem Ship müssen mindestens die Security- und Gate-Funde geschlossen sein. UX, Doku und Feature-Map können danach nachziehen, sie sind allein kein Grund für ein bedingtes Ship.

## Was dieser Branch macht

Gegenüber `origin/main` kommt ein kompletter Social-Pfad: `zane_social_*`-Tabellen und RPCs (Migrationen 0264 bis 0278), Store-Slice plus Realtime, Settings-Toggle `showFriendsTab`, TabBar-Slot geteilt mit Coaching, Friends-Screen (Circle/Activity/Chats), Friend-Requests, DMs mit Bildern, Gruppen, Plan-Shares, Workout-Feed und Cheers/Comments. Im Training hängt ein Toast/Feedback-Poll. Daneben: Food-Tag explizit schließen (`foodDayClosed` / Done for today), X-Handle-Prompt nach dem Onboarding, 60-Minuten-Edit/Delete für Social- und Coaching-Notes.

Der Client-Vertrag in `src/app.jsx:2219-2223` und `docs/database.md` (zu `show_friends_tab`) ist klar: ohne Friends-Tab keine Social-RPCs, keine Social-Queries, kein Realtime. Default ist aus. Genau diesen Vertrag hält der Branch an mehreren Stellen nicht.

## Bestätigte Findings

### security

**p_today und p_week_start sind clientgesteuert** (`supabase/migrations/0277_fix_social_metric_thigh_lookup.sql:18`, derselbe Stand in 0276 und in `social_get_dashboard`)

Warum: `v_adherence_end := LEAST(p_week_start + 7, p_today)` ist die einzige Grenze für Adherence und Nutrition. Es gibt keine Kappung auf `CURRENT_DATE` oder die Zeitzone des Metric-Owners. `store.js` schickt `todayISO()`. Ein Friend kann per direktem RPC `p_today` auf morgen setzen und so die Completed-Day-Grenze aus 0268/0276 umgehen. Mit `p_week_start = heute` und `p_today = morgen` wird das Fenster ein einziger Tag, der heutige Rohwert landet als 1-Tage-Mittel. Historische Fenster für Gewicht, Glucose, Blutdruck und Maße sind frei wählbar. `social_get_dashboard` ist für `authenticated` ausführbar.

Fix: Heute serverseitig aus `zane_user_settings.time_zone` (Fallback `tz_offset_minutes` / `CURRENT_DATE`) rechnen. `p_week_start` auf die aktuelle lokale Woche klemmen oder ältere Fenster ablehnen.

**Edit-Fenster via created_at umgehbar** (`supabase/migrations/0274_chat_message_edit_window.sql:8`)

Warum: Die 60-Minuten-Grenze für Edit/Delete von `zane_social_messages` und `zane_coaching_notes` hängt nur an `created_at`. Die UPDATE-Guards blockieren nach dem Insert jede Änderung dieses Felds, INSERT-Policies und Defaults erzwingen den Zeitstempel aber nicht. Ein Client kann `created_at` in die Zukunft schreiben und danach dauerhaft editieren oder löschen.

Fix: BEFORE-INSERT-Trigger auf beiden Tabellen, der `created_at` immer auf `now()` setzt. Optional zusätzlich `WITH CHECK (created_at BETWEEN now() - interval '1 minute' AND now() + interval '1 minute')`.

**Workout-Detail liefert kg/reps** (`supabase/migrations/0271_social_workout_detail_set_data.sql:39`)

Warum: `social_get_workout_detail` baut Sets mit `kg`, `reps`, `repsL`/`repsR`, `timeSec` und `addedKg`. Der Zugriff läuft über `social_workout_access` und verlangt `workouts_visible`. Settings und `SOCIAL_METRIC_CATALOG` beschreiben den Toggle als Summary bzw. Weekly-Count ("Shared values are summaries or the latest reading"). `docs/database.md:830` und `:834` behaupten weiter eine Redaktion auf Namen und Set-Status. Freunde sehen und laden damit die volle Last.

Fix: Entweder die Felder wieder entfernen und die Doku belassen, oder Toggle-Text, Katalog und Docs klar auf volle Satzdaten umstellen. Halb so, halb so ist ein Privacy-Bug.

**Block gilt nicht in Gruppen** (`supabase/migrations/0264_social_features.sql:300`, `social_block_user` in `schema.sql` um 3819)

Warum: `social_block_user` schreibt den Block und löscht die Friendship, lässt gemeinsame `zane_social_group_members` aber stehen. `social_join_group` prüft Blocks nicht. Message-Send im Group-Zweig, Message-Read, Plan-Share-Read und `social_get_dashboard.groupMembers` filtern `zane_social_blocks` nicht. Ein geblocktes Mitglied sieht weiter Chat, Plan-Snapshots und die als friends-only beschrifteten Steps/Workouts/Adherence.

Fix: In `social_block_user` gemeinsame Gruppenmitgliedschaften entfernen. Join, Message-Policies und `groupMembers` um eine Block-Prüfung in beide Richtungen ergänzen.

**Attachment-Pfad nicht an Uploader gebunden** (`supabase/migrations/0264_social_features.sql:481`)

Warum: Die INSERT-Policy prüft nur `uploaded_by = auth.uid()` und Sender-Status, nicht `storage_path LIKE auth.uid() || '/%'`. Storage-SELECT hängt allein am Pfad plus Teilnahme an der neu verknüpften Nachricht. Nach Message-Delete entfernt `ON DELETE CASCADE` nur die Zeile, das Storage-Objekt bleibt. Sobald die Zeile weg ist, kann jeder mit bekanntem Pfad denselben Pfad an eine eigene Message hängen und das private Objekt neu teilen.

Fix: `WITH CHECK (storage_path LIKE (select auth.uid())::text || '/%')`. Beim Löschen der Message die Storage-Objekte mit entfernen.

### bug

**Train pollt Social-RPC ohne Gate** (`src/screens-train.jsx:734` und `:8045`)

Warum: `TrainingSocialFeedback` hängt in jeder laufenden Session ohne `store.settings.showFriendsTab`. Der Effect ruft sofort und danach alle 2s `LB.loadSocialWorkoutDetail` auf, intern `social_get_workout_detail`. `showFriendsTab` kommt in `screens-train.jsx` nicht vor. Default ist false, also trifft das jeden normalen Trainings-User. Das verletzt den dokumentierten Opt-in-Vertrag in `app.jsx:2219-2223`. `social_workout_access` lässt den Owner immer durch, der SECURITY-DEFINER-RPC läuft deshalb auch bei ausgeschaltetem Tab.

Fix: Komponente nur mounten, wenn `!!store.settings.showFriendsTab`. Interval und ersten Call hinter dasselbe Gate legen, Timer beim Ausschalten sofort stoppen.

**Chat-Edit löscht Attachments lokal** (`src/screens-friends.jsx:579`)

Warum: `saveEditedMessage` merged `{ ...m, ...updated }`. `LB.updateSocialMessage` ruft `mapSocialMessage` ohne Attachment-Liste auf, dadurch kommt immer `attachments: []` zurück. Der Spread überschreibt vorhandene Bilder. Bis ein Realtime-Reload kommt, fehlt das Image, offline bleibt es weg. Serverseitig werden die Bilder in `zane_social_message_attachments` nicht gelöscht.

Fix: Attachments von `m` behalten, sofern `updated.attachments` leer ist: `{ ...m, ...updated, attachments: updated.attachments?.length ? updated.attachments : m.attachments }`.

**In-Flight-Cache verschluckt Refreshes** (`src/store.js:5891`)

Warum: `loadFriendsState` gibt bei gleichem Key `userId:weekStart` die laufende Promise zurück und kennt kein Dirty-Flag. `subscribeToFriends` plus 250ms-Debounce in `app.jsx` ruft dieselbe Funktion erneut auf. Ein Realtime-Tick während des Loads teilt deshalb die erste Runde. Deren Queries sehen später committed Messages, Shares oder Friendships nicht. Nach `finally` ist der Cache leer, ohne Follow-up bleibt der Store stehen.

Fix: In-Flight nur echte Parallel-Caller entdoppeln. Event-getriebene Reloads nach Abschluss noch einmal fahren (dirty-Flag), oder die zweite `loadFriendsState` nicht auf die alte Promise setzen.

**Realtime ohne Reads und Profile** (`src/store.js:6163`)

Warum: `subscribeToFriends` listet Friendships, Groups, Members, Messages, Attachments, Plan-Shares und Workout-Comments, nicht `zane_social_message_reads` und `zane_social_profiles`. `unreadCount` entsteht nur in `loadFriendsState` aus `readsRes`. Markiert ein anderes Gerät Messages als gelesen oder ändert ein Freund `metric_visibility`, bleiben Badge und Circle stehen, bis zufällig eine der sieben Tabellen feuert. Profile sind zusätzlich nicht in `supabase_realtime` und durch RLS plus `REVOKE ALL` für fremde Zeilen ohnehin kein `postgres_changes`-Pfad.

Fix: Reads in dieselbe `postgres_changes`-Liste aufnehmen und danach `refreshFriends` auslösen. Für Profile reicht Realtime allein nicht: Visibility-Änderungen müssen über Dashboard-Refresh oder einen eigenen Kanal laufen.

**Plan-Import lässt Übungsfelder weg** (`src/screens-friends.jsx:705`)

Warum: `importPlan` kopiert neue Übungen über eine Whitelist ohne `progression_increment` und `horn_labels`. Der Snapshot enthält die vollen `store.exercises`-Zeilen. `syncStore` persistiert die fehlenden Felder als `null`. Smart-Progression-Schritt und Multi-Dorn-Setup gehen verloren. Items ohne `idMap`-Treffer behalten die Sender-`exId` und bleiben ein toter Verweis.

Fix: Dieselben Übungsfelder übernehmen wie der restliche Store. Items ohne `idMap`-Treffer nicht mit der fremden `exId` stehen lassen, sondern droppen oder die fehlende Übung nachziehen.

**Plan-Fill ignoriert foodDayClosed** (`src/screens-food.jsx:1458`, dazu `applyToToday` um 7488 und `saveDraft` um 7588)

Warum: Nach Done for today materialisieren Lookahead-Effect, Apply to today und saveDraft weiter geplante Einträge auf heute, ohne `foodDayClosed` zu prüfen oder `reopenFoodDay` aufzurufen. `commitEntries` macht genau das Gegenteil. Der Tag bleibt geschlossen: meal-reminder schweigt, Weekly Adherence zählt den Tag weiter, neue geplante Karten liegen auf einem offiziell fertigen Tag.

Fix: In allen drei Pfaden heute überspringen, wenn `LB.foodDayIsClosed(s.dailyLogs, todayISO)` true ist. Manuelles Apply to today darf den Tag stattdessen über `reopenFoodDay` wieder öffnen, dann analog zu `commitEntries`.

**XHandlePrompt nicht lazy verdrahtet** (`index.html:1704`)

Warum: `makeLazyScreen` registriert nur `OnboardingPrompt` und `OnboardingTour`. `XHandlePrompt` sitzt im Onboarding-Chunk und wird erst beim Chunk-Load auf `window.Screens` gelegt. `app.jsx:2064-2065` setzt `pending=false` und `open=true` ohne `__loadScreenModule`. Für Returning User wird Onboarding nicht gemountet, Idle-Warmup ist das 11. Modul und triggert kein Re-Render. Ist der Chunk kalt, bleibt der Prompt unsichtbar, `xHandlePromptPending` ist trotzdem verbraucht.

Fix: `makeLazyScreen('XHandlePrompt', 'onboarding', { kind: 'overlay' })` analog zu `OnboardingPrompt` eintragen, oder vor `setXHandlePromptOpen` gezielt `window.__loadScreenModule('onboarding')` awaiten.

### ux

**FriendRequestBanner lädt Modul und Placeholder** (`src/app.jsx:2649`)

Warum: `{store && <window.Screens.FriendRequestBanner .../>}` hängt ohne `showFriendsTab`. In `index.html:1693` ist `FriendRequestBanner` ein normales lazy Screen, nicht `silent` wie `CoachingPendingBanner`. `makeLazyScreen` zeigt ohne `silent` den Text "Loading screen..." und startet `loadModule('friends')`. Der interne `showFriendsTab`-Check in `screens-friends.jsx:1277` greift erst nach dem Load.

Fix: Nur mounten, wenn `store.settings.showFriendsTab` gesetzt ist, und analog zu `CoachingPendingBanner` als `makeLazyScreen(..., { silent: true })` registrieren.

**Friend-Request-Modal blockiert alles** (`src/screens-friends.jsx:1308`)

Warum: Festes Vollflächen-Overlay (`position:fixed`, `inset:0`, `zIndex:9000`) ohne Later, Backdrop-Close oder lokalen Dismiss-State. Es hängt in `app.jsx` außerhalb von Layout/Screen und rendert, sobald `store.friends.incoming[0]` existiert. `subscribeToFriends` schreibt nach 250 ms den kompletten Friends-Slice, der Banner kann mitten in einer Session aufgehen. Einen `route.name === 'train'`-Guard gibt es nicht, obwohl UpdateBanner und SW-Checks Train bewusst verschonen. Incoming Requests erhöhen `friends.unreadCount` nicht, nach einem Dismiss gäbe es sonst keinen zweiten Hinweis.

Fix: Nicht-blockierenden Banner nutzen oder mindestens Later. Auf `route.name === 'train'` nicht über das Workout legen. Offene Requests zusätzlich als Badge auf Circle/Chats halten.

**Friends-Unread hinter Coaching versteckt** (`src/ui.jsx:666`)

Warum: Der Social-Tab badged nur den gerade visualisierten Slot. Auf Home (und allen Nicht-Social-Routen) ist `socialSlot` bei aktivem Coaching immer `coaching`. `store.friends.unreadCount` bleibt auf dem Dock unsichtbar.

Fix: Bei beiden Slots die Counts addieren (oder den nicht-null Count zeigen), analog nicht nur den gerade aktiven Slot badgen.

**Friend-Suche ohne Treffer bleibt stumm** (`src/screens-friends.jsx:441`)

Warum: `lookupSocialProfile` mappt eine leere RPC-Antwort auf `null`. `search()` setzt genau diesen Wert und löscht vorher die Karte. `renderSearch` zeigt die Karte nur bei truthy `searchResult` und hat keinen Empty-Zweig. Fehler erscheint nur im `catch`. Nach Find wirkt der Tap tot.

Fix: Null-Treffer als eigenen Empty-Zustand zeigen, zum Beispiel "No matching handle or friend code".

**Friends-Tab nach Toggle unsichtbar** (`src/screens-settings.jsx:2519`)

Warum: Nach dem Einschalten von `showFriendsTab` bleibt der Nav-Slot unsichtbar als Friends, sobald Coaching schon an ist. `SOCIAL_SLOT_ORDER` setzt Coaching zuerst, TabBar fällt ohne Social-Route auf `enabledSocialSlots[0]` zurück, das Label bleibt Coaching, es kommt nur ein zweiter Punkt. Der Friends-Hilfetext nennt nur Preview, nicht den geteilten Slot. Health/Water/Food/Meds tun das explizit. Der Toggle navigiert nicht nach `friends`. Bei aktiver Coaching-Beziehung ist der Coaching-Tab fest gepinnt.

Fix: Denselben Slot-Hinweis wie bei Health setzen (Tippen wechselt, Long-Press springt). Optional nach dem Toggle direkt zur Friends-Route navigieren oder den Slot auf friends legen, solange der User gerade eingeschaltet hat.

**Eigenes Handle nicht auffindbar** (`src/screens-friends.jsx:908`)

Warum: Circle verlangt Handle oder Friend-Code, rendert die eigenen Werte aber nirgends. Die Identifiers liegen im Dashboard, die Anzeige steckt nur in Settings. `XHandlePrompt` und Account versprechen den X-Handle für Social Features, `social_lookup_profile` sucht ihn nicht.

Fix: Im Circle-Hero Handle und Friend-Code mit Copy zeigen. X-Copy auf öffentliches X beschränken oder Lookup zusätzlich über `x_handle` führen und das klar beschriften.

**Copy verspricht Workout-Share, der so nicht gilt** (`src/screens-friends.jsx:941`)

Warum: Der Activity-Leerstand sagt "Finished workouts stay visible from the day you became friends." `social_get_workout_feed` zeigt fremde Live- und History-Sessions nur bei `sp.workouts_visible`. Der Workouts-Toggle und der Sheet-Text tun so, als ginge es um Wochen-Summaries, obwohl derselbe Schalter Live- und History-Sätze mit kg und Reps freigibt.

Fix: Leerstand an die Opt-in-Regel koppeln. Am Workouts-Toggle explizit machen: Wochenzähler plus Live- und History-Feed inklusive Last und Reps.

### unfinished

**Feature-Map ohne Friends** (`src/feature-map-db.js:15`)

Warum: `FEATURE_MAP.version` steht weiter auf `v45 (2026-08-07)`. Es gibt keine `friends`-Kategorie und keine Karten für Circle, Chats, Live-Feed/Cheers, Metric Sharing oder Plan-Snapshots. `home.app-navigation` listet nur Home, Plan, History, Health und Coaching. Meal Times ist dokumentiert, der opt-in Friends-Pfad nicht. `FeatureMapScreen` und `features.html` rendern genau diesen Katalog.

Fix: Kategorie plus Karten anlegen, Navigation um den geteilten Slot ergänzen, `version` auf ein neues v46-Datum ziehen.

### inconsistency

**schema.sql ohne 0276/0277** (`supabase/schema.sql:4483`)

Warum: Die einzige `social_health_metric_value` in `schema.sql` hat zwar schon `v_adherence_end` deklariert, Calories/Protein/Carbs/Fat/Fiber/Water filtern aber weiter gegen `v_week_end` und ziehen den laufenden Tag in die Wochenmittel. 0276/0277 stellen dieselben Zweige auf `v_adherence_end` um. `check-db-docs.cjs` vergleicht nur Funktionsnamen. Ein Rebuild aus `schema.sql` würde Live wieder auf den Leak vor 0276 zurücksetzen.

Fix: Die 0277-Fassade nach `schema.sql` übernehmen (Calories bis Water gegen `v_adherence_end`) und den Snapshot-Vertrag aus `Claude.md` einhalten.

**Doku redigiert Sets, Grant-Vertrag falsch** (`docs/database.md:830` und `:834`)

Warum: Die Doku beschreibt noch den redigierten 0265-Vertrag (nur Namen und Set-Completion) und listet `social_workout_access` gemeinsam mit `social_can_view_workout_session` als authenticated-only. Seit 0271 liefert das Detail kg/reps/timeSec/addedKg plus `weightUnit`. `social_workout_access` ist von PUBLIC, anon und authenticated entzogen, intern wie `social_health_metric_value`. Nutrition/Adherence ohne heute steht dort ebenfalls nicht.

Fix: Docs auf den 0271-Vertrag ziehen. `social_workout_access` als internes Helper ohne Client-EXECUTE führen. Yesterday-Grenze und Set-Felder im selben Absatz nachziehen.

**Close friert Today-Score nicht** (`src/screens-health.jsx:5189`)

Warum: `healthAdherenceLogs` nimmt heute nach `foodDayClosed` in den Wochenschnitt. Der Food-Reconciler behandelt heute trotzdem als laufend: `snap = log.date !== today ? log.targetsSnap : null`. Dieselbe Regel sitzt in `FoodScreen.dayTarget`. `setFoodDayClosed` (`src/screens-food.jsx:2389`) schreibt nur das Flag, nicht `LB.dailyLogAdherence`. Nach Done for today überschreibt ein Target-Wechsel weiterhin adherence und `targetsSnap` von heute.

Fix: In beiden Stellen den Frozen-Snap auch für today nutzen, sobald `foodDayClosed` true ist. `setFoodDayClosed` sollte beim Schließen einmal `LB.dailyLogAdherence` schreiben, analog zu `setMealOfChoice`.

**Cheer-Toast Radius und Theme** (`src/screens-train.jsx:792`)

Warum: Social-Toast nutzt `borderRadius: 10`, Comment-Zeilen `5`. Beides liegt außerhalb der erlaubten Skala 2/4/6/8/999. Der Cheer-Hintergrund ist `linear-gradient(..., rgba(24,22,29,0.98))` und bleibt in Light/Paper fast schwarz.

Fix: Toast auf 8, Listenzeilen auf 4. Hintergrund über `UI.bgRaised` bzw. `rgba(var(--accent-rgb), x)` führen, kein hartes `rgb(24,22,29)`.

### nit

Keine.

## Verworfene Findings

- **Keine Social-Store-Tests** (`tools/test/store.test.cjs`): Coverage-Lücke, kein nachgewiesener Store-Bug. Bleibt als offenes Risiko, nicht als Ship-Blocker-Finding.
- **Cheer bei fertigem Workout versteckt**: Absicht. Cheer-Chips sind Mid-Workout-Texte, Comments bleiben über den Toggle erreichbar.
- **Social-Mapper ohne Tests**: Die Mapper existieren intern und verhalten sich wie vorgesehen. Fehlende Exports bzw. Tests sind keine Laufzeitfehler.

## Offene Risiken / nicht abgedeckt

- Social liegt bewusst nicht im persönlichen Backup (andere User, Server-Conversations). Restore-Verhalten nach Account-Wechsel oder Device-Reset ist damit nicht durch `check-backup-coverage` abgesichert.
- `tools/test/store.test.cjs` hat keine Social-Fälle. In-Flight-Cache, Mapper, Plan-Import-Remap und das Friends-Gate sind ungetestet.
- Grant-Fallen bei neuen SECURITY-DEFINER-Funktionen: im Review nicht jede Signatur gegen `has_function_privilege('anon', ...)` geprüft. Vor dem Deploy die neue Social-RPC-Liste einmal durchlaufen.
- `zane_social_profiles` ist nicht in `supabase_realtime`. Auch nach einem Reads-Subscribe bleibt Circle ein Snapshot, bis ein anderer Kanal feuert.
- Food-Day-Closed und Friends sind unabhängig. Ein User ohne Friends-Tab trifft trotzdem den Train-Poll, den Banner-Load und die Food-Close-Bugs.
- Feature-Map-Publish aus der DB überdeckt den fehlenden Katalog nicht: `features.html` und Nicht-Admins sehen ohne Bake weiter keinen Friends-Pfad.
- Edge Functions und Reminder-Cron sind in diesem Review nicht neu gegen Social geprüft. meal-reminder hängt weiter am geschlossenen Food-Tag, das Plan-Fill ignoriert.

## Vor einem Ship mindestens

1. Gate im Train-Poll und Banner
2. `p_today` serverseitig klemmen
3. `created_at` erzwingen
4. Block in Gruppen
5. Attachment-Pfad binden
6. Workout-Detail vs. Doku/Toggle angleichen

Danach die Client-Bugs (Chat-Attachments, In-Flight, Plan-Import, Food-Close, XHandlePrompt) und die UX-Fallen.
