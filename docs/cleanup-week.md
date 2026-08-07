# Cleanup Week: Implementierungsplan (v2, korrigiert)

> Status: **implementiert** (2026-08-07, Migration 0251). v2 ersetzte den ersten Entwurf komplett: der wurde gegen den echten Code adversarial verifiziert, hatte einen Blocker (fehlende Constraint-Migration) und hielt sein eigenes Kernversprechen ("keine Overreach-/Stagnations-Flags") nicht vollständig ein.
>
> **Abweichungen, die sich erst bei der Umsetzung gezeigt haben** (eine zweite adversariale Review gegen den fertigen Code, Details in `docs/internals.md`):
> 1. **5/3/1-Hauptlifte brauchen eine eigene Exemption.** Sie werden von `buildSessionEntries` direkt aus der Training Max geseedet und sehen `buildSeedSets` nie, sind also nie reduziert. Der Opt-out-Chip hätte dort angeboten, eine bereits vollwertige Wave „wiederherzustellen". Alle Exemptions liegen jetzt in einem `cleanupApplies(exId)`-Helper.
> 2. **Der Opt-out-Chip fasst `done`-Sets nicht mehr an** (Abschnitt 6 wollte pauschal alle skalieren). Bereits geloggte Sets umzuschreiben verfälscht, was der Nutzer real gehoben hat, und wandert über Volumen/e1RM in die Seed-Basis der Folgewoche. Dafür werden jetzt die Runden-Gewichte in `st.drops`/`stretch` mitskaliert, die sonst gegen das gespiegelte `st.kg` auseinanderlaufen.
> 3. **`isCleanupSession` hängt am Seed-Zeitpunkt, nicht am Live-Status**, sonst macht ein Cleanup-Start mitten in einer laufenden Session den Chip zur Gewichtsfalle.
> 4. **Drei Server-/Remote-Pfade brauchten denselben Ausschluss**, die der Plan nicht auf dem Schirm hatte: die RPC `get_exercise_best_e1rm` (harter PR-Floor, exakt der Bug aus Migration 0239), `remoteLast`/`remoteBestE1rmRef` in `screens-train.jsx` und der Cron `auto-close-sessions`.
> 5. Der Test für `dsPreviousSessionForDay` entfällt (Funktion ist nicht exportiert, und nur fürs Testen zu exportieren wäre der falsche Tausch). Die Entscheidung steht stattdessen als expliziter „nicht wegoptimieren"-Kommentar an der Funktion.
>
> **Nachträgliche Design-Korrektur (2026-08-07, nach Nutzer-Feedback):** Abschnitt 6 wollte den kompletten Autoreg-Dialog in der Cleanup-Woche stilllegen (Readiness, Soreness, Joint, Workload) und Earn/Cut über `skipEarnCut` mit ausschalten. Das ist zurückgenommen. Die Fragen laufen normal weiter und bewegen dieselben Deltas und Weight-Boosts. Grund: `reearnMesoWeightBoosts` ersetzt die Keys der laufenden Session wholesale, eine stille Cleanup-Session hätte also nicht nur eine Rotation lang die Set-Counts eingefroren, sondern der Woche danach auch nichts zum Re-Earnen hinterlassen. Nach zwei weiteren Runden Feedback ist die Sonderbehandlung komplett gefallen: die Cleanup-Woche ist autoreg-seitig eine ganz normale Woche. Auch Rep-Miss-Cut, `pumpLowCounts`, Re-entry-Ramp, RIR-Ziel samt Partials und der 8-Cycle-Deload-Nudge laufen wie sonst. Erlaubt sind genau vier Abweichungen: Lastreduktion mit Opt-out, keine Regressions-Anzeigen, keine roten Chips aus der geringeren Last, kein Feuern des Overreach-Detektors. Einzige technische Sonderbehandlung bleibt der `signalWeight`-Pin auf `'full'` (siehe Korrektur 1) plus das daraus abgeleitete `cutSignal`, damit ein Rough-Tag auch dort vor dem Cut schützt. Betroffene Plan-Zeilen, die damit **nicht** mehr gelten: die Quiz-Gates in Abschnitt 6 / Zeile 124, die Earn-Zeile 131, der `skipEarnCut`-Zuschnitt in 132 und die `isMesoSessionEditable`-Erweiterung in Zeile 90 (der Recap trägt jetzt echte Antworten und muss korrigierbar bleiben). Der Stand im Code ist in `docs/internals.md` beschrieben.

## Context

Der Nutzer will nach einer längeren Pause die Technik wieder auf Stand bringen: einen ganzen Zyklus/Woche mit ~20% reduzierten Gewichten pro Übung ("Cleanup Week", bewusst kein Deload), mit per-Übung Opt-out während des Trainings. Die Folgewoche baut auf den reduzierten Gewichten wieder auf (normale Progression). Zwei Nutzer-Entscheidungen: Reduktion **einstellbar 10-30%** (Default 20), Modus **global wie Deload** (ein Status, gilt für alle Pläne, Aktivierung über den Plan-Tab, Auto-Ende nach 1 Cycle / 7 Tagen / Flex-Sessions).

**Kern des Designs** (im Gegensatz zu Deload):
- Cleanup-Sessions sind **normale Sessions** (kein `isDeload`-Flag): die reduzierten Gewichte fließen in die Seed-Kette, damit die Folgewoche darauf aufbaut.
- Die **Autoreg-Bewertung** ignoriert die Woche: kein Earn/Cut, keine rep_miss_counts, keine Regression-/PR-Baselines, keine Overreach-/Stagnations-Flags. Der Nutzer hat explizit betont: "keine Stagnation oder Overreaching, sondern ein geplanter Rückschritt zugunsten besserer Ausführung".

## Was sich gegenüber dem ersten Entwurf ändert

Der erste Entwurf war für seine zwei "tragenden Korrekturen" handwerklich sauber, hatte aber vier reale Lücken (Details in den jeweiligen Abschnitten unten):

1. **Blocker:** `zane_status_periods.mode` UND `zane_user_settings.status_mode` haben live CHECK-Constraints (`... IN ('sick','vacation','deload')`, Migration 0109), nicht nur die eine Tabelle. Ohne Migration schlägt jeder `startCleanup`-Write fehl. → Abschnitt 2.
2. **`isCleanup` wird ein echter synced Column statt "lokal wie progressionBumps".** Anders als der Progressions-Hint betrifft der Verlust von `isCleanup` PR-/Regressions-Baselines über die *gesamte* Historie auf *jedem* Gerät, nicht nur seltene Post-hoc-Edits. Mirror von `is_deload` (Migration 0108/0109). `cleanupOptOuts` bleibt lokal (wirkt nur innerhalb der laufenden Session). → Abschnitt 1, 2, 3.
3. **Das Kernversprechen wird jetzt wirklich eingehalten:** die Live-Soreness-/Joint-Quizzes (schreiben echte Autoreg-Deltas, hingen bisher an keinem der geplanten Gates) und `detectStall` (Geschwisterfunktion von `detectOverreach`, gleicher `signalWeight`-Filter, gleiche Fehlanfälligkeit) werden jetzt explizit ausgeschlossen. → Abschnitt 3, 6.
4. **Earn/Cut-Gate neu geschnitten:** nicht mehr "ganzer Finish-Flow blockiert bei Cleanup", sondern "Earn/Cut blockiert, Block-Abschluss (`handleMesoComplete`) läuft weiter" - eine zufällig block-abschließende Cleanup-Session darf den Block nicht hängen lassen. → Abschnitt 6.
5. **Session-weites Gate vs. Per-Übungs-Opt-out getrennt:** eine opt-out-geschaltete Übung (wieder volle Last) bekommt wieder normale Outlier-/Overlay-Vergleiche, statt weiter wie eine reduzierte Übung behandelt zu werden. → Abschnitt 6.
6. **Coach-Preview** (`screens-coaching-client.jsx`) bekommt denselben Override wie Deload, sonst sieht ein Coach beim Ansehen eines Cleanup-Client-Plans falsche Gewichte. → Abschnitt 8.
7. **`dsPreviousSessionForDay`-Entscheidung getroffen** (war offener Punkt): Cleanup-Sessions bleiben Vergleichsbasis, sonst zeigt die *gesamte* Wiederaufbauwoche einen falschen "-20%"-Rückgang statt eines Anstiegs. → Abschnitt 3.
8. **531-Strip-Titel-Lücke geschlossen:** der 531-Zweig hat einen eigenen, früher greifenden Return, der bisher gar keinen CLEANUP-Hinweis gezeigt hätte. → Abschnitt 5.
9. Alle Zeilenangaben unten sind frisch gegen den Code auf dem Stand von `b101e58` verifiziert (nicht nur plausibilisiert).

## Die zwei tragenden Korrekturen (verifiziert gegen den Code)

**Korrektur 1: Overreach-Basis-Kontinuität.** `detectOverreach` (store.js:8260) zählt nur Sessions mit `signalWeight === 'full'` als Exposures und braucht ZWEI aufeinanderfolgende Regression-/Joint-Signale (`s2.triggered && s1.triggered`, store.js:8284). Würden Cleanup-Sessions aus der Kette fallen (wie Deload), vergliche die Folgewoche gegen die Pre-Cleanup-Exposures und die reduzierte Last wäre über mehrere Wiederaufbau-Wochen "e1RM-Regression" - mit Soreness könnte der Emergent-Deload-Guard feuern. **Lösung: Cleanup-Sessions behalten `signalWeight 'full'`** (das passiert automatisch: `deriveSignalWeight()` in screens-train.jsx:3412 delegiert an `LB.deriveSignalWeight(session, isMesoDeloadSession)`, store.js:7832, das nur auf `isDeload` reagiert, nicht auf `isCleanup`. `deriveSignalWeight` selbst bleibt unangetastet). Earn/Cut wird stattdessen über ein **separates Session-Flag `isCleanup`** ausgeschlossen (siehe Korrektur zum Earn/Cut-Gate in Abschnitt 6, nicht mehr "ganzer Block übersprungen" wie im ersten Entwurf).

**Korrektur 1b (neu, v2): `detectStall` braucht denselben, aber SEPARATEN Ausschluss.** `detectStall` (store.js:8647) ist die Stagnations-/Swap-Erkennung, eine Schwesterfunktion von `detectOverreach` mit demselben Filter-Prinzip: `ended && !isDeload && ... && signalWeight === 'full'` (store.js:8671). Weil Cleanup-Sessions bewusst `signalWeight: 'full'` behalten (Korrektur 1), fließen ihre absichtlich reduzierten e1RM-Werte sonst direkt in diese Serie ein und ein Lift nach einer Cleanup-Woche würde fälschlich als "stalled" markiert (Swap-Vorschlag). Da `signalWeight` hier NICHT zur Unterscheidung taugt (beide Fälle brauchen `'full'`, aus unterschiedlichen Gründen), braucht `detectStall`s Filter einen expliziten zusätzlichen `&& !s.isCleanup` (store.js:8671), unabhängig vom `signalWeight`-Check.

**Korrektur 2: Compounding-Verhinderung.** Ohne Schutz würde jede Cleanup-Session der Woche von der vorherigen Cleanup-Session seeden (0.8 × 0.8 × ...). Da `buildSeedSets` die Session-Referenz nicht kennt (nur Sets, verifiziert: alle Call-Sites übergeben nur `{ entry: { sets } }`), wird die Reduktion in der Seed-Historie gefenstert: **während `statusMode === 'cleanup'` schließt `recentSessionsForExercise` (store.js:3346) Sessions mit `startedAt >= statusModeSince` aus** und `fetchSeedEntries` (store.js:3437) Server-Rows mit `ended >= sinceISO` (die RPC `get_exercise_history`, siehe supabase/schema.sql:1413-1438, kennt kein `started_at`, nur `ended`). Ergebnis: Jede Cleanup-Session seedet von der vollen Pre-Cleanup-Basis + einmal Faktor. Nach dem Auto-Ende sind dieselben Cleanup-Sessions die neue Basis (genau das gewünschte "Folgewoche baut auf").

## 1. Datenmodell

- **`statusMode === 'cleanup'`**: vierter Status-Wert auf den bestehenden `status_mode`/`status_mode_since`-Textspalten (`zane_user_settings`) und `zane_status_periods.mode`. **Migration nötig** (siehe Abschnitt 2, anders als im ersten Entwurf angenommen): beide Spalten tragen live CHECK-Constraints, die nur `sick`/`vacation`/`deload` erlauben.
- **Neues Setting `cleanup_percent`** (int 10-30, Default 20): neue Spalte auf `zane_user_settings` (Migration 0251), geräteübergreifend, bleibt für die nächste Aktivierung.
- **`is_cleanup` ist eine echte, synced Spalte** (anders als im ersten Entwurf): neue Spalte auf `zane_sessions`, exaktes Mirror von `is_deload` (Migration 0108). Grund für den Kurswechsel: `isCleanup` steuert PR-/Regressions-Baselines (`bestE1rmForExercise` etc.) und `dsPreviousSessionForDay` über die *gesamte* Historie auf *jedem* Gerät. Als reines lokales Flag (progressionBumps-Muster) würde ein zweites Gerät (neues Handy, iOS-Storage-Eviction, Neuinstall) diese Baselines für alle bisherigen Cleanup-Sessions rückwirkend falsch berechnen, dauerhaft. `zane_sessions` ist in `tools/check-backup-coverage.cjs` als PASSTHROUGH klassifiziert (`entries`/`completed_server_at` sind die einzigen Ausnahmen), eine neue Spalte round-trippt also automatisch ohne zusätzliche Allowlist-Pflege.
- **`cleanupOptOuts` bleibt lokal-only** (exId -> true, progressionBumps-Muster): wirkt nur innerhalb der laufenden Session (Live-Rescaling der angezeigten Sets), nicht rückwirkend auf Baselines, dafür ist der Verlust auf einem anderen Gerät unkritisch. Aus `sessionToRow` (store.js:2016) herausdestrukturiert, in `mergeSessions` (store.js:4641, Carry-Forward-Zeile analog 4705) mitgeführt. Keine neue Spalte.
- **Faktor**: `(100 - percent) / 100`, Rundung aufs 2.5er-Raster wie Deload (`Math.round(x * factor / 2.5) * 2.5`). Exemptions wie Deload: bodyweight, assisted, time, cardio (`bodyweightKg == null && !isAssistedEx`, store.js:3273). 531-Main-Lifts: nicht betroffen (eigene Wave-Mathematik über die Training Max, eigene Deload-Woche), nur history-geseedete Assistenz-Übungen werden reduziert.

## 2. Migration + Settings-Plumbing (CLAUDE.md-Workflow)

1. `supabase/migrations/0251_cleanup_week.sql`, in dieser Reihenfolge (mirror von 0108+0109, aber diesmal in einer Migration statt nachträglich gepatcht):
   ```sql
   ALTER TABLE zane_user_settings
     ADD COLUMN IF NOT EXISTS cleanup_percent integer NOT NULL DEFAULT 20;

   ALTER TABLE zane_sessions
     ADD COLUMN IF NOT EXISTS is_cleanup boolean NOT NULL DEFAULT false;

   ALTER TABLE zane_user_settings
     DROP CONSTRAINT IF EXISTS zane_user_settings_status_mode_check;
   ALTER TABLE zane_user_settings
     ADD CONSTRAINT zane_user_settings_status_mode_check
       CHECK (status_mode IN ('sick', 'vacation', 'deload', 'cleanup'));

   ALTER TABLE zane_status_periods
     DROP CONSTRAINT IF EXISTS zane_status_periods_mode_check;
   ALTER TABLE zane_status_periods
     ADD CONSTRAINT zane_status_periods_mode_check
       CHECK (mode IN ('sick', 'vacation', 'deload', 'cleanup'));
   ```
   **Nutzer explizit auf das Ausführen hinweisen.**
2. `supabase/schema.sql`: `cleanup_percent`- und `is_cleanup`-Spalte in den jeweiligen CREATE TABLE ergänzen. **Zusätzlich einen bestehenden Doku-Drift beheben:** die `zane_user_settings_status_mode_check`-Constraint aus Migration 0109 fehlt im aktuellen schema.sql-Snapshot komplett (nur `zane_status_periods.mode` zeigt ihre Constraint inline, schema.sql:2212), obwohl die Migration nie zurückgenommen wurde. Beide Constraints jetzt korrekt (inkl. `'cleanup'`) im Snapshot abbilden.
3. `docs/database.md`: `zane_status_periods`-Mode-Liste (Zeile ~540) UND den zweiten Beleg im `zane_user_settings`-Abschnitt (Zeile ~578, "status_mode ... sick|vacation|deload") um `'cleanup'` erweitern, beide Stellen, nicht nur eine. `cleanup_percent` (Store-Feld `cleanupPercent`) und `is_cleanup` (Store-Feld `isCleanup`) in den jeweiligen Tabellen-Abschnitten ergänzen.
4. `store.js` an den 4 Settings-Stellen für `cleanup_percent`: `loadFromSupabase`-Mapping (nach `feverThresholdC`, ~1749), `settingsChanged`-Diff in `syncStore` (~2556), Upsert-Objekt (~2614), `settingsRow` in `importFromBackup` (~532). Das CI-Gate `check-backup-coverage.cjs` erzwingt das.

## 3. store.js-Änderungen

- **`buildSeedSets` (store.js:3254)**: 8. Param `cleanupOpts = { percent, optOuts, sinceISO } | null`; Fallback `window.__CLEANUP` (Objekt, nicht Boolean wie `window.__DELOAD`, siehe Abschnitt 4, das ist ein bewusster Formunterschied). Faktor-Logik: `factor = deload ? 0.5 : (cleanupActive && !optedOut && bodyweightKg == null && !isAssistedEx ? (100 - pct) / 100 : null)`; `dl = (kg) => factor && kg != null ? Math.round(kg * factor / 2.5) * 2.5 : kg`. Zeile 3303 erweitern: `baseKg = (deload || cleanupActive) && prev?.kg != null ? prev.kg : suggestion.kg` (Faktor auf die echte letzte Last, nicht auf den Suggestion-Nudge, exakt wie der bestehende Deload-Kommentar an dieser Zeile es für Deload begründet). Kein Compounding-Guard hier (Korrektur 2 regelt das über die Fenster-Funktionen unten).
  - Die 4 Swap/Add-Re-Seed-Call-Sites in screens-train.jsx (4962, 5032, 5103, 5154) übergeben aktuell **kein** `deloadOverride` (nur 6 der 7 Parameter), verlassen sich auf den `window.__DELOAD`-Fallback. Für Cleanup gilt dasselbe: kein explizites 8. Argument nötig, `window.__CLEANUP` greift automatisch. Eine frisch geswappte/hinzugefügte Übung hat ohnehin nie einen bestehenden `cleanupOptOuts`-Eintrag.
- **`recentSessionsForExercise` (store.js:3346)**: Filter-Erweiterung `&& !(state.statusMode === 'cleanup' && state.statusModeSince != null && s.startedAt != null && s.startedAt >= state.statusModeSince)`.
- **`fetchSeedEntries` (store.js:3437)**: analog zum bestehenden `deloadIds`-Muster (Zeile 3451) einen `cleanupExcludeIds`/`sinceISO`-Check ergänzen und in der Merge-Schleife (Zeile 3453-3454) mitprüfen: `if (!merged.some(...) && !deloadIds.has(row.sessionId) && !(cleanupSinceISO && row.ended >= cleanupSinceISO)) merged.push(row);`.
- **`is_cleanup`-Plumbing (real synced, siehe Abschnitt 1):**
  - SELECT-Liste store.js:1211 um `is_cleanup` ergänzen.
  - Load-Mapping store.js:1519 (`...(s.is_deload ? { isDeload: true } : {})`): analoge Zeile `...(s.is_cleanup ? { isCleanup: true } : {})`.
  - `sessionToRow` (store.js:2004): `isCleanup` NICHT wie `progressionBumps` aus der Destrukturierung (Zeile 2016) herausnehmen, sondern wie `isDeload` behandeln: in die Destrukturierung aufnehmen und bei Zeile 2023 `row.is_cleanup = !!isCleanup;` ergänzen.
- **`cleanupOptOuts`-Plumbing (lokal-only):** aus `sessionToRow`s Destrukturierung (2016) mit herausnehmen (wie `progressionBumps`), in `mergeSessions` (4641) Carry-Forward-Zeile analog zu 4705 ergänzen: `...(mem.cleanupOptOuts ? { cleanupOptOuts: mem.cleanupOptOuts } : {})`.
- **Autoreg-Ausschluss (Earn/Cut):** siehe Abschnitt 6, das Gate wandert von screens-train.jsx (Aufrufstelle) in `computeMesoGains` selbst (screens-train.jsx-lokal, keine store.js-Funktion), store.js wird dafür nicht angefasst.
- **Regression-/PR-Baselines:** `bestE1rmForExercise` (store.js:2933), `bestAssistLoad` (2956), `bestTimeForExercise` (2975): `s.isCleanup` zusätzlich in den bestehenden `s.isDeload`-Skip aufnehmen.
- **`isMesoSessionEditable` (store.js:7450, neu in v2):** Zeile 7451 `if (!session || !mesoState || !session.ended || session.isDeload) return false;` um `|| session.isCleanup` erweitern. Ohne das könnte ein Nutzer nachträglich Soreness-/Joint-Feedback auf einer bereits beendeten Cleanup-Session editieren (`applyMesoFeedbackEdit`, 7501) und damit direkt echte `mesoState.deltas` schreiben, komplett am Finish-Gate vorbei. Feedback existiert für eine Cleanup-Session ohnehin nicht (Quiz-Gating, siehe Abschnitt 6), aber die Guard-Bedingung sollte trotzdem explizit sein, falls der Recap künftig doch mal Daten trägt.
- **`detectStall` (store.js:8647, neu in v2):** Filter bei Zeile 8671 um `&& !s.isCleanup` erweitern, siehe Korrektur 1b oben.
- **`dsPreviousSessionForDay` (store.js:6915): KEINE Änderung** (Kurswechsel gegenüber dem ersten Entwurf, siehe "Was sich ändert" Punkt 7). Cleanup-Sessions bleiben gültige Vergleichsbasis für "last time this exact workout was done". Ausschluss würde die *gesamte* Wiederaufbauwoche dauerhaft gegen die Pre-Cleanup-Last vergleichen (persistenter "-20%"-Rückgang statt des korrekten Anstiegs), das widerspricht Korrektur 2 direkt (die Folgewoche soll auf der Cleanup-Last aufbauen, nicht gegen sie abfallen).
- **Deload-Helfer-Spiegel (store.js:6608-6710):** `cleanupElapsed` / `cleanupDaysRemaining` / `startCleanup` / `endCleanup` (exakte Spiegel von `deloadElapsed`/`deloadDaysRemaining`/`startDeload`/`endDeload`; Flex-Zählung ohne isDeload-Filter, hier ohne isCleanup-Filter) + Exports (~9109). `startCleanup` ruft `openStatusPeriod(userId, 'cleanup', ...)` (store.js:6543) auf, das jetzt dank Abschnitt 2 einen gültigen Constraint-Wert schreibt.
- **Nicht anfassen:** `deriveSignalWeight` (store.js:7832, siehe Korrektur 1), `mesoPausedDays` (~7952), `blockSessions` (store.js:8374: Cleanup-Sessions bleiben im Block, wie Deload-Sessions), `detectOverreach` selbst (store.js:8260, Korrektur 1 macht das Anfassen unnötig).

## 4. app.jsx

Neben `window.__DELOAD` (1842): `window.__CLEANUP = store?.statusMode === 'cleanup' ? { percent: store?.settings?.cleanupPercent ?? 20, sinceISO: store?.statusModeSince ?? null } : null;`. Bewusst ein Objekt statt eines Booleans wie `__DELOAD`: `buildSeedSets` braucht Prozent + Zeitfenster, nicht nur ein An/Aus. Konsument in `buildSeedSets` prüft entsprechend `window.__CLEANUP != null`, nicht `=== true`.

## 5. screens-home.jsx

- **Auto-Ende**: Effekt-Spiegel von 1971-1979: `LB.endCleanup(...)` wenn `LB.cleanupElapsed(store)`.
- **Strip-Titel, Nicht-531-Zweig** (periodLabel, 1572/1615/1617): `CLEANUP`-Zweige neben DELOAD, wie im ersten Entwurf.
- **Strip-Titel, 531-Zweig (1569-1571, fehlte im ersten Entwurf komplett):** der 531-Zweig hat einen eigenen, früher greifenden Return (`if (LB.is531Plan(sch)) { ...; return dl531 ? ... : ...; }`), der NIE bis zur allgemeinen `store.statusMode === 'deload'`-Zeile (1572) durchfällt. Ohne eigene Behandlung zeigt ein 531-Plan während Cleanup gar keinen Hinweis, obwohl Assistenzübungen sehr wohl reduziert werden. Fix: `const cl531 = store.statusMode === 'cleanup' && weekOffset === 0;` ergänzen, Priorität DELOAD > CLEANUP (beide gleichzeitig ist ausgeschlossen, `statusMode` ist ein einzelner Wert, aber `dl531` kann zusätzlich durch `w531 === 4` triggern): `return dl531 ? 'CYCLE X · DELOAD' : cl531 ? 'CYCLE X · CLEANUP' : 'CYCLE X · WEEK Y'`.
- **Today-Card** (3267): `'Cleanup mode active'`-Zweig, CLEAR-Button funktioniert über `clearStatusMode`.
- **pendingMeso2-Guard** (2051): `statusMode === 'deload' || statusMode === 'cleanup'`.
- **8-Wochen-Nudge** (2157, 2172): `!s.isDeload && !s.isCleanup` (Cleanup zählt nicht zu den 8 normalen Blöcken).
- **Keine Änderung**: "MESO · DELOAD"-Badge (3022) - Cleanup ist eine normale Meso-Woche, das RIR-Target gilt.

## 6. screens-train.jsx

**Zwei getrennte Gate-Konzepte** (Kurswechsel gegenüber dem ersten Entwurf, der ein einziges `isCleanupSession` überall verwendet hätte):

- **Session-weit** `isCleanupSession = store.statusMode === 'cleanup' || session.isCleanup` (deklariert neben `isMesoDeloadSession`, screens-train.jsx:3407): steuert Dinge, die pro Session (nicht pro Übung) entschieden werden. `isMesoDeloadSession` selbst bleibt unverändert.
- **Per Übung** `isCleanupReduced(exId) = isCleanupSession && !session.cleanupOptOuts?.[exId]`: steuert Gewichtsvergleiche, die für eine opt-out-geschaltete (wieder auf Vollgewicht laufende) Übung wieder normal funktionieren sollen, statt weiterhin wie eine reduzierte Übung behandelt zu werden.

**Wo `isCleanupReduced(entry.exId)` (per-Übung) ergänzt wird** (jeweils ODER-verknüpft mit der bestehenden Deload-Bedingung, gleiche Begründung wie dort: reduzierte Last darf nicht als Outlier/Regression gegen die volle Referenz gelesen werden):
- Outlier-Check (`_isDeloadSet`, 1546).
- Progression-Hint (`progressionTargetForSet`, 1217).
- Overlay-Suppression in `completeSet` (`isDeloadSession`, 1676).
- Overlay-Suppression in `flashOverlayForCompletedSet` (`isDeloadSession`, 1786).

**Wo `isCleanupSession` (session-weit) ergänzt wird:**
- **Live-Quiz-Trigger (neu in v2, kritische Lücke im ersten Entwurf):** Soreness-Trigger (`useEffectT`-Guard, 4113: `if (!mesoState || !entry || isCardio || isMesoDeloadSession) return;`) und Joint-Trigger (4180, identische Guard-Form) beide um `|| isCleanupSession` erweitern. Diese Sheets hängen an eigenen `useEffect`s, NICHT am Finish-Gate, ihre Handler (`handleSorenessAnswer`/`handleJointAnswer`/`handleVolumeAnswer`) committen direkt echte Deltas ins `mesoState` (`commitContrib`). Ohne dieses Gate liefe die Session weiterhin normale Recovery-Fragen und schriebe Autoreg-Deltas, das genaue Gegenteil des Kernversprechens.
- **`mesoPartials`** (3019): inline-Check wie beim bestehenden Deload-Guard (TDZ: `isCleanupSession` wird erst bei 3407 deklariert, textuell nach 3019, also wie die bestehende Zeile selbst inline schreiben statt referenzieren): `!(store.statusMode === 'deload' || session.isDeload) && !(store.statusMode === 'cleanup' || session.isCleanup)`.
- **Finish-Stamping** (2354 + 2466): `...(store.statusMode === 'cleanup' ? { isCleanup: true } : {})`.

**Earn/Cut-Gate (2439, neu geschnitten gegenüber dem ersten Entwurf):** Die äußere Bedingung `if (mesoState && !isMesoDeloadSession)` bleibt **unverändert** (kein `&& !isCleanupSession`). Grund: der Block enthält nicht nur `computeMesoGains`/Earn-Cut, sondern auch die Block-Abschluss-Erkennung (`isComplete`, 2440) und `handleMesoComplete()` (2530-2534). Bei Deload ist das Weglassen sicher, weil ein Deload laut Code-Invariante immer erst NACH Block-Abschluss beginnt (mesoWeek ist während Deload eingefroren). Diese Invariante gilt für nutzerinitiiertes Cleanup nicht (kann jederzeit gestartet werden), eine block-abschließende Cleanup-Session hinge sonst fest. Stattdessen wird `computeMesoGains` (screens-train.jsx:3948, lokale Funktion) selbst cleanup-aware:
- Am Anfang der Funktion `isCleanupSession` per Closure lesen (Deklaration bei 3407 liegt textuell vor 3948, kein TDZ-Problem).
- Die rep-miss-Streak-Zeile 4015 (`if (signalWeight === 'full' && !streakSeen.has(key))`) um `&& !isCleanupSession` erweitern, damit ein Cleanup-Session weder die Streak vorantreibt noch einen Cut auslöst (spiegelt exakt, wie `signalWeight === 'none'` das für Deload schon tut, aber Cleanup kann diesen Weg nicht nutzen, weil `signalWeight` für Korrektur 1 `'full'` bleiben MUSS).
- Die EARN-Zeile 4045 (`weightBoostMap[key] = increment; gainMap[key]...`) ebenfalls hinter `!isCleanupSession` stellen, damit eine Cleanup-Session keinen Weight-Boost verdient.
- Die Persist-Zeilen 4062-4070 (`newWeightBoosts`/`newWeightBoostDeclines`) bekommen dieselbe Behandlung wie beim bestehenden `signalWeight === 'none'`-Zweig, jetzt zusätzlich für `isCleanupSession`: `const skipEarnCut = signalWeight === 'none' || isCleanupSession;` einmal oben definieren, an beiden Stellen statt `signalWeight === 'none'` verwenden.
- Die `isComplete`/`finalMeso`/`completions`/`pendingMeso2`/Flush-Logik (4079-4093) bleibt **unverändert und läuft immer**, unabhängig von `isCleanupSession`. Ein block-abschließender Cleanup-Finish setzt `pendingMeso2` also weiterhin korrekt, `handleMesoComplete()` funktioniert wie gewohnt (Meso-2-Angebot, Deload-Angebot etc.), nur ohne dass die Cleanup-Session selbst Boosts/Cuts einbringt.
- Konsequenz (verifiziert): `gainMap` bleibt für eine Cleanup-Session leer → `computeMesoGains` gibt `[]` zurück → am Call-Ort (2523) öffnet sich das Gains-Sheet nicht (`gains.length > 0` ist falsch) → `buildMesoRecap(gains)` (3898) gibt `null` zurück, weil sowohl `groups` (leer, dank Quiz-Gating oben) als auch `gainRows` (leer) leer sind (Zeile 3911: `if (!groups.length && !gainRows.length) return null;`) → kein `mesoRecap` wird gestempelt. Kein manueller Zusatz-Check nötig, ergibt sich aus den beiden Gates oben.
- Der Overreach-Detector-Nudge-Block (2477-2522, `pendingDeloadOfferRef`) **braucht keine Änderung**: er ist bereits über `mesoState.weeks == null && !store.statusMode` (2477) für JEDEN aktiven Status gegated, Cleanup eingeschlossen. Das gilt nur während der aktiven Cleanup-Periode; direkt nach Cleanup-Ende öffnet sich das Gate wieder und wertet eine Historie inklusive der `signalWeight: 'full'`-Cleanup-Sessions aus. Das ist beabsichtigt (Korrektur 1: die Cleanup-Woche selbst liefert nie zwei aufeinanderfolgende Signale, siehe Zwei-Exposure-Mechanismus oben), kein Zusatzrisiko.

**Training-Header-Badge** (6251): `CLEANUP · ${100 - pct}%` (gleiches Styling wie DELOAD, radius 4, Pill-Konvention).

**Per-Übung-Opt-out** (Exercise-Header, 6308-6359, direkt nach der Pill-Reihe bei 6350-6359 einzufügen): Chip mit `onClick`, sichtbar nur wenn `isCleanupSession && !isCardio && !isNoWeightReps && equipment !== 'bodyweight' && !isAssisted && logMode !== 'time'`. Label `FULL` (opt-out aktiv) / `${100 - pct}%` (Reduktion aktiv). **Border-Radius 4** (nicht 2): der Chip hat einen Toggle-Handler, nach der `Pill`-Komponente (ui.jsx:705-718: `rest.onClick ? 4 : 2`) und der CLAUDE.md-Regel "interaktiv oder nicht" MUSS ein antippbarer Chip radius 4 nutzen, auch bei 9px-Schrift. Handler `toggleCleanupOptOut(exId)`: rescaled ALLE Sets der Entry (Warmup + Working, done oder nicht) mit `1/f` (opt-out an) bzw. `f` (opt-out aus), 2.5er-Rundung, togglet `session.cleanupOptOuts[exId]`. Inert außerhalb Cleanup (Button versteckt, Map wird ignoriert, siehe `isCleanupReduced` oben).

**Swap/Add-Re-Seeds** (4962, 5032, 5103, 5154): keine Änderung nötig, siehe Abschnitt 3 (`window.__CLEANUP`-Fallback greift automatisch, wie bei Deload).

## 7. screens-schedule.jsx (Plan-Tab)

- **Start-Flow**: Button "Start cleanup week" (Muster des Deload-Buttons 87-102). Wenn ein anderer Status aktiv ist: Confirm ("This will end your X status"); sonst MiniSheet mit **Prozent-Stepper** (-5/+5, clamp 10-30, Draft) + Erklärtext + Cancel/Start. Beim Start: `cleanupPercent` in den Settings setzen (syncStore diff't) und `LB.startCleanup(...)`.
- **Aktiv-Zustand** (unter dem Deload-Button, 321-333): `Cleanup active · Nd left · End` (fa-broom), End-Confirm + `LB.endCleanup`.

## 8. Restliche Anzeige-Branches

- **screens-settings.jsx (2602-2603)**: Perioden-Liste: Icon `fa-broom` (im Repo noch ungenutzt, thematisch passend), Label `CLEANUP`.
- **screens-coaching-tabs.jsx (396, 407)**: Client-Status-Chip `CLEANUP` + `fa-broom` (RPC liefert `status_mode` unverändert durch).
- **screens-coaching-client.jsx:718 (neu in v2, im ersten Entwurf komplett übersehen):** der Coach-Preview-Aufruf `LB.buildSeedSets(item, last, suggestion, ex?.unilateral, clientStore, bodyweightKg, clientStore.statusMode === 'deload')` übergibt `deloadOverride` bewusst explizit (store.js:3265f-Kommentar: verhindert, dass der GLOBALE `window.__DELOAD` des Coaches statt des Clients einfließt). Ohne denselben Override für Cleanup sähe ein Coach beim Ansehen des Plans eines Clients in einer Cleanup-Woche falsche Gewichte. 8. Argument ergänzen: `clientStore.statusMode === 'cleanup' ? { percent: clientStore.settings?.cleanupPercent ?? 20, optOuts: null, sinceISO: clientStore.statusModeSince ?? null } : null`. `optOuts: null` ist hier korrekt, der Coach sieht die Basis-Reduktion, keine Live-Session mit Opt-outs.
- **screens-lib.jsx**: Regression-Baselines `isCleanup` ausschließen (sameDaySessions 3195, prevEntryMap 3646, prevSameDay 3655, prMap 3711).
- **screens-health.jsx (1482)**: keine Änderung (Deload ist dort bewusst nicht, Cleanup ebenso).
- **docs/internals.md (neu in v2, im ersten Entwurf vergessen):** kurzer Cleanup-Absatz direkt neben der bestehenden Deload-Dokumentation (Exemptions-Logik, History-Windowing-Interaktion), plus Querverweis von dort auf diesen Plan. CLAUDE.md verlangt, diese Datei vor Änderungen an History-Windowing/5-3-1/Assisted-Exercises zu lesen, ohne den Absatz verwaist die Doku für die nächste Person, die dort arbeitet.

## 9. Implementierungsreihenfolge

1. Migration 0251 + schema.sql (inkl. Doku-Drift-Fix der fehlenden `zane_user_settings`-Constraint) + docs/database.md (Migration ausführen lassen!)
2. store.js: Settings-Plumbing (4 Stellen für `cleanup_percent`) + `is_cleanup`-Plumbing (SELECT-Liste, Load-Mapping, `sessionToRow`) + `cleanupOptOuts`-Plumbing (`sessionToRow`-Destrukturierung, `mergeSessions`)
3. store.js: Window-Exclusion (`recentSessionsForExercise`/`fetchSeedEntries`), `buildSeedSets`-Faktor, `bestE1rmForExercise`/`bestAssistLoad`/`bestTimeForExercise`-Baselines, `isMesoSessionEditable`, `detectStall`, `cleanupElapsed`/`startCleanup`/`endCleanup` + Exports
4. app.jsx `window.__CLEANUP`
5. screens-train.jsx: `isCleanupSession`/`isCleanupReduced` deklarieren, Quiz-Gates (4113/4180), Earn/Cut-Gate-Umbau in `computeMesoGains`, per-Übung-Gates (1217/1546/1676/1786), Opt-out-Chip + Handler, Badge, Finish-Stamping
6. screens-home.jsx (inkl. 531-Strip-Fix) + screens-schedule.jsx
7. screens-settings.jsx + screens-coaching-tabs.jsx + screens-coaching-client.jsx + screens-lib.jsx
8. docs/internals.md-Absatz
9. Store-Tests + Verifikation

## 10. Tests (`tools/test/store.test.cjs`)

- `buildSeedSets` mit `cleanupOpts = { percent: 20, optOuts: null }`: Seed = `round(kg * 0.8 / 2.5) * 2.5`; Faktor auf `prev.kg` statt `suggestion.kg`; `optOuts`-Passthrough (opt-out-Exercise seedet unreduziert); bodyweight/assisted-Passthrough; Prozent-Clamp (5 -> 10, 40 -> 30).
- `recentSessionsForExercise`: cleanup + `statusModeSince` schließt Sessions ab since aus; ohne Status inklusive.
- `cleanupElapsed`: weekday 7 Tage, date-based ein Cycle, flex sessions_per_week; `cleanupDaysRemaining` clamps auf 0.
- **Neu:** `detectStall` mit einer `isCleanup`-Session in der Serie: wird übersprungen, kein falsches "stalled".
- **Neu:** `isMesoSessionEditable` mit `session.isCleanup = true`: gibt `false` zurück.
- **Neu:** `bestE1rmForExercise`/`bestAssistLoad`/`bestTimeForExercise` mit einer `isCleanup`-Session als einziger Historie: keine Baseline (analog zum bestehenden `isDeload`-Test).
- **Neu:** `dsPreviousSessionForDay` mit einer `isCleanup`-Session in der Historie: WIRD als "previous" zurückgegeben (Gegenprobe zum expliziten Nicht-Ausschluss, damit ein künftiger Refactor die Entscheidung nicht versehentlich umdreht).

## 11. Verifikations-Checkliste

- `node tools/check-syntax.cjs`, `check-emdash.cjs`, `test/store.test.cjs`, `check-db-docs.cjs`, `check-backup-coverage.cjs` (`cleanup_percent` UND `is_cleanup` müssen round-trippen, letzteres automatisch über den `zane_sessions`-PASSTHROUGH).
- Manuell, Migration: `startCleanup` schreibt tatsächlich einen `zane_status_periods`-Row mit `mode = 'cleanup'` ohne Constraint-Fehler (roter DB-Indikator wäre das Symptom des alten Bugs, siehe Migration 0109).
- Manuell, Basisverhalten: Start mit Default 20%, Settings-Spalte persistiert; Seeds 80% auf 2.5er-Raster, Warmup-Ramp skaliert; zweite Cleanup-Session seedet gleich (kein Compounding); "Last time" zeigt Pre-Cleanup-Session für die erste Cleanup-Session, zeigt die vorherige Cleanup-Session für die zweite; Opt-out rescaled alle Sets inkl. Warmups, Toggle zurück; opt-out-geschaltete Übung zeigt wieder normale Outlier-/Regression-Vergleiche; Swap/Add seeden reduziert; keine "too low"-Warnung für nicht-opt-out Übungen.
- Manuell, Autoreg-Isolation (kritischer Teil von v2): **während** einer Cleanup-Session erscheinen KEINE Soreness-/Joint-Sheets; kein Gains-Sheet/kein "Mesocycle complete!"-Dialog-Inhalt mit Boosts/Cuts; kein `mesoRecap` auf der Session gespeichert. Eine Cleanup-Session, die absichtlich (Testszenario: `mesoState.weeks` klein setzen) den letzten Meso-Block abschließt, triggert TROTZDEM `handleMesoComplete()` (Meso-2-/Deload-Angebot erscheint) und `pendingMeso2` wird gesetzt.
- Manuell, Post-Cleanup: nach Cleanup-Ende triggern zwei Wiederaufbau-Sessions KEINEN Deload-Offer (Exposure-Kontinuität); nach Cleanup-Ende zeigt keine der folgenden Sessions "stalled" für eine während Cleanup trainierte Übung.
- Manuell, Coach: Coach-Preview eines Client-Plans während der Client in Cleanup ist zeigt reduzierte Gewichte, nicht den Coach-eigenen Status.
- Manuell, Rand: 8-Wochen-Nudge zählt Cleanup nicht; 531-Main-Lifts unverändert, 531-Strip-Titel zeigt CLEANUP; Perioden-Historie mit Broom-Icon; Backup-Roundtrip inkl. `is_cleanup`.
- Kein Cache-Bump ohne Aufforderung.

## 12. Verbleibende akzeptierte Trade-offs

1. **`cleanupOptOuts` bleibt lokal-only.** Post-hoc-Edits auf einem Gerät, das die Session nie gecacht hat, verlieren die Opt-out-Info. Weit geringere Tragweite als beim ursprünglich geplanten `isCleanup`-als-lokal-Flag (das jetzt ein echter Column ist, siehe Abschnitt 1): Opt-out wirkt nur live während der Session, nicht auf spätere Baselines.
2. **Back-to-back Cleanup-Wochen** würden compoundieren (zweite Woche von der ersten Basis, gleiche Mechanik wie bei zwei Deload-Wochen hintereinander). Pathologisch, akzeptiert, dokumentiert.
3. **8-Wochen-Nudge**: nur der Flex-Pfad kann Cleanup-Sessions ausschließen; Wochen-/Cycle-Pfade sind kalenderbasiert (bestehende Einschränkung, gilt strukturell auch für Deload).
