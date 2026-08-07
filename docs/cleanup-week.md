# Cleanup Week: Implementierungsplan

> Status: **geplant, nicht implementiert** (2026-08-07). Dieses Dokument ist der freigegebene Entwurf; die Umsetzung erfolgt später.

## Context

Der Nutzer will nach einer längeren Pause die Technik wieder auf Stand bringen: einen ganzen Zyklus/Woche mit ~20% reduzierten Gewichten pro Übung ("Cleanup Week", bewusst kein Deload), mit per-Übung Opt-out während des Trainings. Die Folgewoche baut auf den reduzierten Gewichten wieder auf (normale Progression). Zwei Nutzer-Entscheidungen: Reduktion **einstellbar 10-30%** (Default 20), Modus **global wie Deload** (ein Status, gilt für alle Pläne, Aktivierung über den Plan-Tab, Auto-Ende nach 1 Cycle / 7 Tagen / Flex-Sessions).

**Kern des Designs** (im Gegensatz zu Deload):
- Cleanup-Sessions sind **normale Sessions** (kein `isDeload`-Flag): die reduzierten Gewichte fließen in die Seed-Kette, damit die Folgewoche darauf aufbaut.
- Die **Autoreg-Bewertung** ignoriert die Woche: kein Earn/Cut, keine rep_miss_counts, keine Regression-/PR-Baselines, keine Overreach-/Stagnations-Flags. Der Nutzer hat explizit betont: "keine Stagnation oder Overreaching, sondern ein geplanter Rückschritt zugunsten besserer Ausführung".

## Die zwei tragenden Korrekturen (verifiziert gegen den Code)

**Korrektur 1: Overreach-Basis-Kontinuität.** `detectOverreach` (store.js:8250) zählt nur Sessions mit `signalWeight === 'full'` als Exposures und braucht ZWEI aufeinanderfolgende Regression-Signale (s2 && s1, 8274). Würden Cleanup-Sessions aus der Kette fallen (wie Deload), vergliche die Folgewoche gegen die Pre-Cleanup-Exposures und die reduzierte Last wäre über mehrere Wiederaufbau-Wochen "e1RM-Regression" - mit Soreness (aus dem Meso-Recap, 8166-8170) könnte der Emergent-Deload-Guard feuern. **Lösung: Cleanup-Sessions bekommen `signalWeight 'full'`** (sie bleiben Exposures, die Cleanup-Woche senkt selbst die Vergleichsbasis; die Folgewoche regressiert nicht, und die Cleanup-Woche allein liefert nie zwei aufeinanderfolgende Signale). Earn/Cut wird stattdessen über ein **separates lokales Session-Flag `isCleanup: true`** ausgeschlossen (beim Finish neben `isDeload` gestempelt, screens-train.jsx:2354).

**Korrektur 2: Compounding-Verhinderung.** Ohne Schutz würde jede Cleanup-Session der Woche von der vorherigen Cleanup-Session seeden (0.8 × 0.8 × ...). Da `buildSeedSets` die Session-Referenz nicht kennt (nur Sets), wird die Reduktion in der Seed-Historie gefenstert: **während `statusMode === 'cleanup'` schließt `recentSessionsForExercise` (store.js:3346) Sessions mit `startedAt >= statusModeSince` aus** und `fetchSeedEntries` (3452) Server-Rows mit `ended >= sinceISO` (RPC kennt kein started_at). Ergebnis: Jede Cleanup-Session seedet von der vollen Pre-Cleanup-Basis + einmal Faktor. Nach dem Auto-Ende sind dieselben Sessions die neue Basis (genau das gewünschte "Folgewoche baut auf").

## 1. Datenmodell

- **`statusMode === 'cleanup'`**: vierter Status-Wert, keine Migration (text-Spalten `status_mode`/`status_mode_since` + `zane_status_periods.mode`).
- **Neues Setting `cleanup_percent`** (int 10-30, Default 20): neue Spalte auf `zane_user_settings` (Migration 0251), geräteübergreifend, bleibt für die nächste Aktivierung.
- **Session-Flags lokal-only** (progressionBumps-Muster): `isCleanup` + `cleanupOptOuts` (exId -> true). Aus `sessionToRow` (2016) herausdestrukturiert, in `mergeSessions` (4705) mitgeführt. Keine neue zane_sessions-Spalte.
- **Faktor**: `(100 - percent) / 100`, Rundung aufs 2.5er-Raster wie Deload (`Math.round(x * factor / 2.5) * 2.5`). Exemptions wie Deload: bodyweight, assisted, time, cardio (`bodyweightKg == null && !isAssistedEx`, 3273). 531-Main-Lifts: nicht betroffen (eigene Wave-Mathematik + eigene Deload-Woche), nur history-geseedete Assistenz-Übungen werden reduziert.

## 2. Migration + Settings-Plumbing (CLAUDE.md-Workflow)

1. `supabase/migrations/0251_cleanup_percent.sql`: `ALTER TABLE zane_user_settings ADD COLUMN IF NOT EXISTS cleanup_percent integer NOT NULL DEFAULT 20;` - **Nutzer explizit auf das Ausführen hinweisen.**
2. `supabase/schema.sql`: Spalte im CREATE TABLE ergänzen.
3. `docs/database.md`: `zane_status_periods`-Mode-Liste um `'cleanup'` erweitern (540) + Bullet; `zane_user_settings`-Abschnitt um `cleanup_percent` (Store-Feld `cleanupPercent`).
4. `store.js` an allen 4 Settings-Stellen: `loadFromSupabase`-Mapping (nach `feverThresholdC` ~1749), `settingsChanged`-Diff in `syncStore` (~2556), Upsert-Objekt (~2614), `settingsRow` in `importFromBackup` (~532). Das CI-Gate `check-backup-coverage.cjs` erzwingt Punkt 4.

## 3. store.js-Änderungen

- **`buildSeedSets` (3254-3337)**: 8. Param `cleanupOpts = { percent, optOuts, sinceISO } | null`; Fallback `window.__CLEANUP` (Objekt mit percent/sinceISO) wie `__DELOAD`. Faktor-Logik: `factor = deload ? 0.5 : (cleanupActive && !optedOut && bodyweightKg == null && !isAssistedEx ? (100 - pct)/100 : null)`; `dl = (kg) => factor && kg != null ? Math.round(kg * factor / 2.5) * 2.5 : kg`. Zeile 3303: `baseKg = (deload || cleanupActive) && prev?.kg != null ? prev.kg : suggestion.kg` (Faktor auf die echte letzte Last, nicht auf den Suggestion-Nudge). Kein Compounding-Guard hier (Korrektur 2 regelt das).
- **`recentSessionsForExercise` (3346)**: Filter-Erweiterung `&& !(state.statusMode === 'cleanup' && state.statusModeSince != null && s.startedAt != null && s.startedAt >= state.statusModeSince)` + Kommentar.
- **`fetchSeedEntries` (3452)**: bei cleanup + sinceISO Server-Rows mit `row.ended >= sinceISO` überspringen.
- **`isCleanup`-Plumbing**: `sessionToRow` (2016) + `mergeSessions` (4705).
- **Autoreg-Ausschluss (Earn/Cut)**: `revertMesoSessionBoosts` (7318): early return bei `isDeload || isCleanup`; Scans (7330, 7341) überspringen Cleanup-Sessions.
- **Regression-/PR-Baselines**: `bestE1rmForExercise` (2936), `bestAssistLoad` (2959), `bestTimeForExercise` (2978): `s.isCleanup` in den Skip (reduzierte Last ist keine PR-Basis).
- **`dsPreviousSessionForDay` (6918)**: `!s.isCleanup` ergänzen (Entscheidungspunkt, siehe unten).
- **Deload-Helfer-Spiegel (6608-6710)**: `cleanupElapsed` / `cleanupDaysRemaining` / `startCleanup` / `endCleanup` (exakte Spiegel von `deloadElapsed`/`deloadDaysRemaining`/`startDeload`/`endDeload`; Flex-Zählung ohne isDeload-Filter) + Exports (9099).
- **Nicht anfassen**: `deriveSignalWeight` (7822), `mesoPausedDays` (7956), `blockSessions` (8364: Cleanup-Sessions bleiben im Block), `detectOverreach` selbst.

## 4. app.jsx

Neben `window.__DELOAD` (1842): `window.__CLEANUP = store?.statusMode === 'cleanup' ? { percent: store?.settings?.cleanupPercent ?? 20, sinceISO: store?.statusModeSince ?? null } : null;`

## 5. screens-home.jsx

- **Auto-Ende**: Effekt-Spiegel von 1971-1979: `LB.endCleanup(...)` wenn `LB.cleanupElapsed(store)`.
- **Strip-Titel** (1572, 1615, 1617): `CLEANUP`-Zweige neben DELOAD.
- **Today-Card** (3267): `'Cleanup mode active'`-Zweig, CLEAR-Button funktioniert über `clearStatusMode`.
- **pendingMeso2-Guard** (2051): `statusMode === 'deload' || statusMode === 'cleanup'`.
- **8-Wochen-Nudge** (2157, 2172): `!s.isDeload && !s.isCleanup` (Cleanup zählt nicht zu den 8 normalen Blöcken).
- **Keine Änderung**: "MESO · DELOAD"-Badge (3022) - Cleanup ist eine normale Meso-Woche, das RIR-Target gilt.

## 6. screens-train.jsx

- **`isCleanupSession = store.statusMode === 'cleanup' || session.isCleanup`** (neben 3407).
- **Finish-Stamping** (2354 + 2466): `...(store.statusMode === 'cleanup' ? { isCleanup: true } : {})`.
- **Earn/Cut-Gate** (2439): `if (mesoState && !isMesoDeloadSession && !isCleanupSession)` - der ganze Gains-Flow wird übersprungen (kein "Mesocycle complete!", keine rep-miss-Cuts), signalWeight bleibt 'full'.
- **Gating-Erweiterungen** (jeweils eine Zeile): Outlier-Check (1546), Overlay-Suppressionen (1676, 1786 - kein falscher "decline"-Toast gegen die Pre-Cleanup-Last), Progression-Hint (1217), `mesoPartials` (3019).
- **Training-Header-Badge** (6251): `CLEANUP · ${100 - pct}%` (gleiches Styling wie DELOAD).
- **Per-Übung-Opt-out** (Exercise-Header 6308-6359): Button-Chip, sichtbar nur wenn `isCleanupSession && !isCardio && !isNoWeightReps && equipment !== 'bodyweight' && !isAssisted && logMode !== 'time'`. Label `FULL` (opt-out) / `${100-pct}%`. Handler `toggleCleanupOptOut`: rescaled ALLE Sets der Entry (Warmup + Working, done oder nicht) mit `1/f` bzw. `f`, 2.5er-Rundung, setzt `cleanupOptOuts[exId]`. Inert außerhalb Cleanup (Button versteckt, Map ignoriert).
- **Swap/Add-Re-Seeds** (4962, 5032, 5103, 5154): 8. Argument `LB.buildSeedSets` aus dem frischen State `s` berechnen: `(s.statusMode === 'cleanup' ? { percent, optOuts: X.cleanupOptOuts || null, sinceISO } : null)`.

## 7. screens-schedule.jsx (Plan-Tab)

- **Start-Flow**: Button "Start cleanup week" (Muster des Deload-Buttons 87-102). Wenn ein anderer Status aktiv ist: Confirm ("This will end your X status"); sonst MiniSheet mit **Prozent-Stepper** (-5/+5, clamp 10-30, Draft) + Erklärtext + Cancel/Start. Beim Start: `cleanupPercent` in den Settings setzen (syncStore diff-t) und `LB.startCleanup(...)`.
- **Aktiv-Zustand** (unter dem Deload-Button, 321-333): `Cleanup active · Nd left · End` (fa-broom), End-Confirm + `LB.endCleanup`.

## 8. Restliche Anzeige-Branches

- **screens-settings.jsx (2602-2603)**: Perioden-Liste: Icon `fa-broom`, Label `CLEANUP`.
- **screens-coaching-tabs.jsx (396, 407)**: Client-Status-Chip `CLEANUP` + `fa-broom` (RPC liefert status_mode unverändert).
- **screens-lib.jsx**: Regression-Baselines `isCleanup` ausschließen (sameDaySessions 3195, prevEntryMap 3646, prevSameDay 3655, prMap 3711).
- **screens-health.jsx (1482)**: keine Änderung (Deload ist dort bewusst nicht, Cleanup ebenso).

## 9. Implementierungsreihenfolge

1. Migration 0251 + schema.sql + docs/database.md (Migration ausführen lassen!)
2. store.js: Settings-Plumbing (4 Stellen) + isCleanup/cleanupOptOuts-Plumbing (sessionToRow/mergeSessions)
3. store.js: Window-Exclusion (recentSessionsForExercise/fetchSeedEntries), buildSeedSets-Faktor, Autoreg-Ausschlüsse, Baselines, cleanupElapsed/startCleanup/endCleanup + Exports
4. app.jsx `window.__CLEANUP`
5. screens-train.jsx (Opt-out, Gating, Badge, Swap-Seeds)
6. screens-home.jsx + screens-schedule.jsx
7. screens-settings.jsx + screens-coaching-tabs.jsx + screens-lib.jsx
8. Store-Tests + Verifikation

## 10. Tests (`tools/test/store.test.cjs`)

- `buildSeedSets` mit `cleanupOpts = { percent: 20, optOuts: null }`: Seed = `round(kg * 0.8 / 2.5) * 2.5`; Faktor auf `prev.kg` statt `suggestion.kg`; `optOuts` Passthrough; bodyweight/assisted Passthrough; Prozent-Clamp (5 -> 10, 40 -> 30).
- `recentSessionsForExercise`: cleanup + statusModeSince schließt Sessions ab since aus; ohne Status inklusive.
- `cleanupElapsed`: weekday 7 Tage, date-based ein Cycle, flex sessions_per_week; `cleanupDaysRemaining` clamps auf 0.
- `revertMesoSessionBoosts` mit `isCleanup` = gleiche Referenz zurück.

## 11. Verifikations-Checkliste

- `node tools/check-syntax.cjs`, `check-emdash.cjs`, `test/store.test.cjs`, `check-db-docs.cjs`, `check-backup-coverage.cjs` (cleanup_percent muss round-trippen).
- Manuell: Start mit Default 20%, Settings-Spalte persistiert; Seeds 80% auf 2.5er-Raster, Warmup-Ramp skaliert; zweite Cleanup-Session seedet gleich (kein Compounding); "Last time" zeigt Pre-Cleanup; Opt-out rescaled alle Sets inkl. Warmups, Toggle zurück; Swap/Add seeden reduziert; keine "too low"-Warnung; kein Gains-Sheet/kein "Mesocycle complete!"/keine rep-miss-Cuts während Cleanup; nach Cleanup: zwei Wiederaufbau-Sessions triggern keinen Deload-Offer (Exposure-Kontinuität); 8-Wochen-Nudge zählt Cleanup nicht; 531-Main-Lifts unverändert; Perioden-Historie mit Broom-Icon; Backup-Roundtrip.
- Kein Cache-Bump ohne Aufforderung.

## 12. Gekennzeichnete Entscheidungspunkte

1. **`dsPreviousSessionForDay` (6918)**: `isCleanup` ausschließen heißt: Die Tages-Zusammenfassung der Wiederaufbau-Tage vergleicht gegen die Pre-Cleanup-Last (zeigt einen "-20% Faller"-Hinweis). Alternative: Cleanup-Sessions als Vergleichsbasis behalten (konsistent mit Train-Screen und Overreach-Kontinuität). Implementierung folgt der Direktive, dem Nutzer wird der Trade-off vorgelegt.
2. **Lokal-only-Flags**: Post-hoc-Edits auf einem Gerät, das die Session nie gecacht hat, verlieren `isCleanup`/`cleanupOptOuts`. Eine Spalten-Variante wäre möglich (Migration + Backup-Roundtrip), wird aber nicht gebaut (gleiche Klasse wie progressionBumps).
3. **Back-to-back Cleanup-Wochen** würden compoundieren (zweite Woche von der ersten Basis). Pathologisch, akzeptiert, dokumentiert.
4. **8-Wochen-Nudge**: nur der Flex-Pfad kann Cleanup-Sessions ausschließen; Wochen-/Cycle-Pfade sind kalenderbasiert.
