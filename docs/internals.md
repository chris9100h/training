# Interna & Feature-Deep-Dives

Detailwissen zu den komplexeren Subsystemen. Vor Änderungen am jeweiligen Bereich
den passenden Abschnitt lesen; die verbindlichen Grundregeln stehen in CLAUDE.md.

## Precompile-Loader (Boot-Performance)

- Die `screens-*.jsx`/`ui.jsx`/`app.jsx` werden **nicht** als `<script type="text/babel">` geladen. Ein Loader in `index.html` transpiliert jede Datei **einmal** (Presets `react` + `env` mit `targets: { esmodules: true }`, sourceType `script`), cacht das fertige JS in IndexedDB (`zane-precompile`, Key = Pfad + Content-Hash) und führt bei Folgestarts das gecachte JS direkt aus.
- Der `esmodules`-Target (statt des ungesetzten ES5-Downlevel-Defaults) ist ca. 5x schneller transpiliert (gemessen) und unkritisch, weil die App wegen IndexedDB/Service Worker/Fetch ohnehin nur auf modernen Evergreen-Browsern läuft.
- **Babel Standalone wird nur noch bei Cache-Miss** (neue/geänderte Datei) lazy geladen; bei leerem Cache (First Boot / Incognito) wird der Download spekulativ parallel zum JSX-Fetch gestartet statt erst danach. `html2canvas` wird erst beim ersten Screenshot geladen. React läuft als **Production-Build**.
- Schlägt der Loader fehl, fällt er automatisch auf den alten Pfad „Babel transpiliert alles" zurück.
- Ändert sich `PRESETS`/`PRESET_TAG` im Loader, muss `tools/check-syntax.cjs` mit denselben Presets nachgezogen werden.
- **Neue `.jsx`-Datei:** in `SOURCES` im Loader (`index.html`, in Ausführungsreihenfolge) und `ASSETS` in `sw.js` eintragen; ein eigenes `<script>`-Tag gibt es nicht (der Loader lädt sie). Der Content-Hash invalidiert den Cache bei jeder Änderung automatisch.

## System-Übungskatalog (`src/exercise-db.js`)

Read-only Katalog `window.SYSTEM_EXERCISES`; plain JS wie `whatsnew.js` (normales `<script>` in `index.html`, in `ASSETS` von `sw.js`).

- **Format:** kompakte Einträge `{ id: 'sys_…', name, tags, equipment, category, movement, logMode }` (Defaults: `movement`→`bilateral`, `logMode`→`weight`).
- `category` (`big`|`medium`|`small`) ist die Rest-Timer-Größe (mappt auf die `restBig`/`restMedium`/`restSmall`-Settings, ohne sie greift der flache Default) und ist bewusst auf **jedem** Eintrag gesetzt, damit eine duplizierte Kopie sofort eine sinnvolle Pausenzeit hat statt auf den Default zu fallen.
- **Library-UI:** als **„Database"**-Tab angezeigt (read-only, durchsuchbar/filterbar). **„Check & Add"** öffnet das gewohnte Review-Sheet (`ExerciseCreator`, vorbefüllt aus dem Katalog-Eintrag per `seed`-Prop, Wizard übersprungen); erst beim Speichern unten (`save()`) wird eine **frische, editierbare User-Übung** in `store.exercises` angelegt (`movement`→`movement_type`/`unilateral`, `logMode`→`log_mode`/`no_weight_reps` gemappt). So kann der User vor der Übernahme noch alles anpassen. „In library"-Markierung per Namensabgleich; **„✓ Added"** erst nach dem Speichern im Sheet.
- **`LB.systemExerciseToRow`** ist der programmatische Normalizer für direkte Duplizierung: genutzt vom **`ExercisePicker`** (`screens-schedule.jsx`, geteilt von Plan-Editor und Training-Add/Swap/Superset).
- Der Picker blendet den System-Katalog **on-demand** ein (nur bei aktiver Suche/Muskel-Filter, damit die Schnellansicht die eigene Library bleibt) unter einem „DATABASE"-Abschnitt (Rows mit „DB"-Pill); Katalog-Einträge mit gleichnamiger User-Übung werden ausgeblendet.
- Beim Picken legt `finalizePick` eine editierbare Kopie in `store.exercises` an (oder mappt auf die gleichnamige bestehende) und reicht nur deren User-Id an `onPick`: **Pläne/Sessions halten also nie `sys_`-Ids.**
- Die Training-Consumer (`doAdd`/`doSwap`/`linkNewExercise`) lösen die Übung via funktionalem `setStore(s => LB.findExercise(s, id))` aus frischem State auf und sehen die eben angelegte Kopie also korrekt.
- Bewusst **kein** direkter `sys_`-Referenz-Overlay: Pläne/Sessions halten nur User-eigene Ex-Ids, daher kein neuer Auflösungspfad/Sync-Sonderfall.

## Plan-Setup-Wizard (`PlanWizard`)

`ScheduleNewScreen` (Route `schedule-new`, in `screens-schedule.jsx`) rendert nur noch `PlanWizard`, einen geführten Skelett-Builder im Stil des Exercise Creators (Overlay-Card z-9998, segmentierte Progress-Bar, `optRow`-Zeilen, Klartext-Erklärungen). Er baut per `LB.buildPlanSkeleton(...)` das Schedule-Objekt, hängt es an `store.schedules` und navigiert dann zu `schedule-edit`.

- **Schritte:** Basisfolge `['name','type','split','weekdays','meso']` mit demselben conditional-Ordering-Prinzip wie der Exercise Wizard (`adjacentPlanStep`): `split` nur bei Cycle/Flex, `weekdays` nur bei Weekday. Der Step-Motor ist dynamisch (kein statisches `PLAN_ORDER`): `computePlanSteps({type, presetKey, customCount})` fügt die Per-Tag-Schritte ein, `goNext(override)` rechnet die Liste mit dem frischen Pick neu.
- **Split-Presets** (`SPLIT_PRESETS` in `store.js`) sind `{ block, repeats }` (`full3`/`ul4`/`ppl3`/`ppl6`) und werden je Typ verschieden zu Tagen: **Cycle** schließt jeden Block mit einem `REST`-Tag ab (PPL×2 → PUSH PULL LEGS REST PUSH PULL LEGS REST, „rest days included" stimmt so), **Flex** wiederholt den Block flach ohne Rest (Flex hat keine Rest-Tage), **Weekday** mappt die Rotation round-robin auf die gewählten Wochentage.
- **Custom** (nur Cycle/Flex): Tageszahl-Stepper (nach oben offen), dann **je Tag ein eigener Wizard-Schritt** (`day0..dayN-1`, dynamisch via `computePlanSteps`) mit Typ-Grid aus `STANDARD_DAY_TYPES`. Darunter (per Knurl + „Custom days"-Label abgesetzt) die eigenen `store.customDayTypes` (jeweils mit Zwei-Tap-×-Löschen, da ein portaliertes Confirm-Sheet hinter dem z-9998-Overlay läge), eine „+ Custom day type"-Inline-Anlage (persistiert wie im `DayTypePicker` nach `store.customDayTypes`; `REST` bei Flex ausgeblendet) und „Import a day from a plan".
- **Day-Import:** wizard-nativer Import-View statt des `DayCopyPicker`-Sheets (das bei z-100 hinter dem z-9998-Overlay läge). Zwei Schritte: erst Plan/Group aus `store.schedules` + „Templates"-Group aus `store.workoutTemplates` wählen, dann Tag(e) daraus per Multi-Select. Füllt N Tage ab dem aktuellen inkl. Übungen und verlängert Cycle/Flex bei Bedarf; Weekday cappt auf die restlichen Slots.
- Ein `customDays`-Eintrag ist entweder ein Typ-String oder `{ name, items }` (importierter Tag mit deep-kopierten Items, Superset-Gruppen-Ids neu vergeben), von `buildPlanSkeleton` normalisiert. Gespeichert in `customDays`; ohne Auswahl Fallback = N×`FULL`.
- **Weekday-Guard:** die gewählten Wochentage müssen **exakt** `LB.splitDayCount(presetKey)` sein (sonst geht die Rotation nicht glatt auf, z.B. PPL×2 auf 5 Tage → PUSH PULL LEGS PUSH PULL, LEGS zu selten); „Next" ist sonst gesperrt mit Hinweis (zu wenige/zu viele). Custom (kein Preset) ist frei.
- **Meso-Schritt:** voll konfigurierbar (Wochen 4-8, Start-RIR 0-3, End-RIR -3-0), setzt `mesocycle_weeks`/`_start_rir`/`_end_rir`. Je Typ: Cycle minimal · Weekday `mode:'weekday'` + `weekday`-Tage · Flex `is_flex:true` + `sessions_per_week` = Tageszahl.
- Die Frequenz-Notizen (`LB.frequencyHint`) und der RIR-Taper-Preview (`LB.mesoTaperPreview`) sind als LB-Helfer extrahiert und werden von Wizard **und** Editor-Options-Sheet geteilt (identischer Text).
- Die `zane_meso_states`-Zeile legt weiterhin der Home/Train-Effekt bei Plan-Aktivierung an, nicht der Wizard.
- Ein „Skip setup"-Ausgang (Name/Type-Schritt) legt wie früher einen leeren Cycle-Plan an.
- Die Wizard-Shell ist bewusst aus `ExerciseWizard` (`screens-lib.jsx`) dupliziert, damit der ausgelieferte Exercise Wizard unberührt bleibt.
- Die Onboarding-Tour navigiert nicht mehr in `schedule-new` (früher zwei `data-tour`-Spotlights `schedule-name`/`schedule-mode`), sondern beschreibt den geführten Setup in einer `target:null`-Karte (sonst z-index-Kollision mit dem z-9998-Overlay).

## History-Windowing (Boot lädt nicht mehr die ganze Historie)

Seit v2.085 lädt der Boot **konstant viele Sets**, unabhängig vom Account-Alter
(Phase 2 von Migration 0059; per-Session-Aggregate aus Migration 0060):

- **Boot-Fenster:** `loadFromSupabase` lädt Session-*Metadaten* weiterhin **vollständig** (Streaks/Kalender brauchen die Datumsliste), aber `zane_session_entries`/`zane_sets` nur für die letzten `HISTORY_WINDOW_DAYS` (70 Tage, deckt den 8-Wochen-Chart) **plus** die In-Progress-Session. Der `entries`-JSONB-Select und der JSONB-Fallback sind entfernt (alle Alt-Sessions wurden in Migration 0031 relational backgefüllt).
- **Sessions außerhalb des Fensters** haben `entries: []` und tragen die Aggregate `aggVolume`/`aggDoneSets`/`aggExercises` (aus `get_session_stats`). `totalVolume()`/`doneSetCount()` fallen automatisch darauf zurück; `aggExercises > 0` unterscheidet eine gefensterte von einer echt leeren Session. Die Session-Detail-Ansichten (eigene + Coach) laden die Sets bei Bedarf nach (`fetchSessionEntries`, RLS: own + coach-of).
- **PR-Erkennung:** `bestE1rmForExercise` = max(`store.exerciseBests`-Aggregat, lokal geladenes Fenster); deckt auch Sessions ab, die seit dem Boot lokal beendet wurden. Das Aggregat wird beim Training-Mount refresht.
- **Seeds/Progression:** `fetchSeedEntries` fragt `get_exercise_history` nur für Übungen, deren lokales Fenster < 3 Sessions hat (Normalfall: 0 RPCs, komplett offline-fähig); Server- und Lokal-Treffer werden per Session-Id dedupliziert gemerged. Die Session-Start-Flows (`startSession`, „Log"-Banner, Not-logged-Modal) awaiten das **vor** dem Anlegen der Session.
- **Merge in `app.jsx`:** Der Sessions-Teil des Cache-first-Merges ist als `LB.mergeSessions` in `store.js` extrahiert (unit-getestet). Die „Server hat sie nicht mehr → löschen"-Logik arbeitet auf der weiterhin vollständigen Metadaten-Liste; **gecachte Entries** von Sessions außerhalb des Fensters bleiben erhalten (Bestandsgeräte behalten ihre volle Offline-Historie). Lokale Einträge, die der Server nicht hat, werden nur behalten, wenn sie **nie bestätigt gesynct** waren (nicht in der persistierten Sync-Base aus `loadBase`); sonst würde ein Gerät auf einem anderen Gerät Gelöschtes wieder hochsyncen (Resurrection). Gilt für Sessions, Exercises, Schedules und Skips; ohne Base (Alt-Cache) wird konservativ behalten.
- **Offline:** Aggregate + Fenster liegen im localStorage-Store-Cache; ohne Netz laufen PR-Erkennung/Stats/Listen aus dem Cache. Die RPC-Helfer (`fetchSeedEntries` etc.) fallen bei Fehlern still auf lokale Daten zurück.
- **Bekannte, akzeptierte Degradationen** (nur frische Geräte, Sessions älter als das Fenster): Set-für-Set-Vergleiche/PR-Sterne in **alten** Session-Details vergleichen nur gegen Fenster+Cache; `setsPerMuscle` beim Zurückblättern in alte Cycles ist leer; die „Recent"-Liste der Library umfasst nur das Fenster.
- **Spalte zuletzt droppen:** `zane_sessions.entries` erst per separater Migration entfernen. Der Boot selektiert sie nicht mehr, aber erst droppen, wenn alle Clients auf ≥ v2.085 sind (alte SW-Caches laden sonst noch den alten Boot-Code, dessen Select dann 400 würfe).
