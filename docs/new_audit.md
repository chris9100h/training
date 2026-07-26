# Deep Audit Logbook / Zane PWA, 26.07.2026

## Executive Summary

12 Domain-Scans über das ganze Produkt (Store/App-Shell, UI-Primitives, Train, Schedule, Home/Lib, Health/Water/Cardio, Food, Coaching, Settings/Onboarding, Backend/Edge, globaler Halbfertig-Sweep) haben 148 Kandidaten geliefert. Jeder Kandidat ist einzeln adversarisch gegengeprüft worden: 117 wurden mit unabhängigem Code-Beleg bestätigt, 31 widerlegt (bereits gefixt, missverstanden oder bewusstes Design). Nach Deduplizierung über Domains hinweg bleiben **103 eigenständige Befunde**.

Der Gesamtzustand ist gut. Die Architektur ist konsistent durchgezogen, die Sync-Pipeline hat an vielen Stellen genau die Guards, die man erwarten würde (`unwrap`, `mergeSessions`-Anti-Resurrection, Staleness-Guards in den Batch-RPCs, uid-Guards in `flushSync`/`flushBeforeSignOut`). Fast alle schweren Befunde sind **Lücken in einem Muster, das die Codebase sonst korrekt anwendet**: eine Stelle, an der der bereits existierende Guard fehlt. Das macht sie billig zu fixen.

Drei Themen zuerst:

1. **Der Backup-/Restore-Pfad ist der gefährlichste Bereich der App.** Er ist delete-then-write, hat kein Undo, und drei unabhängige Defekte greifen genau dort ineinander: Gewichte werden bei `unit === 'mixed'` fälschlich mal 2,20462 gerechnet, Food-Logs älter als 30 Tage werden serverseitig gelöscht, obwohl das Backup sie nie enthielt, und der Export selbst kann still fehlschlagen, ohne dass Schritt 2 gesperrt wird. Das sind die einzigen Befunde im Audit, die unwiederbringliche Nutzerdaten vernichten.

2. **Der Sync-Loop hat einen Single Point of Failure ohne Reparaturpfad.** Ein einziges Food-Log mit nicht gecachtem `food_id` blockiert per FK-Verletzung den kompletten `Promise.all`-Batch, also auch Sessions, Sets und Health. Der Nutzer sieht dauerhaft roten Sync-Status und verliert beim Sign-out alles seit dem letzten erfolgreichen Flush. Verwandt: `mergeSessions` verwirft nie gesyncte Sessions älter als 2 Tage, was genau in diesem Szenario zuschlägt.

3. **Merge- und Refresh-Pfade sind uneinheitlich abgesichert.** Der Boot-Merge hat einen base-aware Guard, `softRefresh` hat ihn nicht. `flushSync` hat einen uid-Guard, der Hintergrund-Merge in `loadData` nicht. Der Settings-Merge lässt lokale Werte pauschal gewinnen, obwohl der Diff-Base auf den Serverstand gesetzt wurde. Alle drei sind Ein-Zeilen- bis Zehn-Zeilen-Fixes am selben Ort (`src/app.jsx`).

Nicht bewertet wurden Style-Meinungen, fehlende Tests und Refactoring-Wünsche. Alles hier ist ein Defekt: es crasht, verliert Daten, schlägt still fehl, widerspricht einer Hausregel oder ist für den Nutzer sichtbar inkonsistent bzw. halbfertig.

## Zahlen

| Severity | Anzahl | Bedeutung |
|---|---:|---|
| critical | 3 | unwiederbringlicher Datenverlust oder Totalausfall des Syncs |
| high | 5 | sichtbare Fehlfunktion oder stille Datenkorruption |
| medium | 36 | Bug, den Nutzer treffen, von dem sie sich aber erholen |
| low | 59 | kosmetisch, inkonsistent, tot oder Doku-Drift |
| **gesamt (dedupliziert)** | **103** | |

| Kind | Anzahl |
|---|---:|
| bug | 25 |
| data-loss | 18 |
| ui-inconsistency | 16 |
| doc-drift | 8 |
| half-finished | 7 |
| dead-code | 7 |
| ux | 7 |
| sync | 5 |
| security | 5 |
| convention | 3 |
| data-corruption | 1 |
| perf | 1 |

Pipeline-Zahlen: 148 Kandidaten, 117 CONFIRMED, 31 REFUTED, **0 UNCERTAIN** (die Verifikation hat jeden Kandidaten eindeutig entschieden), 14 Befunde beim Dedup zusammengelegt.

Überschneidung mit `docs/deep-audit-report.md` (Vor-Audit, 23 Befunde): nur ein Befund ist identisch und weiterhin real (`collapse_water_logs` ohne REVOKE FROM authenticated). Zwei weitere sind thematisch benachbart, aber technisch andere Defekte (Settings-Upsert-Thema, `DayTypePicker`-Import-Thema). Alles andere im alten Report ist entweder gefixt oder hier nicht erneut aufgetaucht.

---

## Sofort fixen

### C1 [critical/sync] Ein einziges Food-Log ohne gecachtes `food_id` blockiert den kompletten Sync-Loop

**Datei(en):** `src/store.js:1697` (Write), `src/screens-food.jsx:2150` (Ursache), `supabase/functions/search-foods/index.ts:453,480` (verschärfend)

**Was passiert:** Beim Loggen eines Suchtreffers wird die `zane_foods`-Cache-Zeile fire-and-forget angestoßen, das Log aber unabhängig davon mit `foodId` in den Store geschrieben. Schlägt die Cache-Erzeugung fehl, verletzt der `zane_food_logs`-Upsert den FK und wirft 23503.

**Warum:** `food_id text REFERENCES public.zane_foods(id)` (`supabase/schema.sql:2284`) ist ein echter FK. `syncStore` schreibt `food_id: l.foodId ?? null` ungeprüft. `confirmLogFood` feuert `ensureFoodCached(pendingFood)` ohne `await` und ohne Ergebnisprüfung, im Gegensatz zu `toggleFavorite`, das awaitet und bei `if (!cached) return;` abbricht (`screens-food.jsx:2037-2044`). Da `unwrap` wirft und der Flush `await Promise.all(ops.map(unwrap))` (`store.js:2032`) macht, gilt der **gesamte** Batch als gescheitert: `syncBase` bleibt stehen, alle 15 s wird derselbe Diff neu verschickt und nie bestätigt. Der einzige Re-Cache-Effekt überspringt geloggte foodIds explizit (`!loggedFoodIds.has(f.foodId)`, `screens-food.jsx:330`), es gibt also keinen Reparaturpfad. Zusätzlich antwortet die Edge Function auch dann `{ ok: true }`, wenn sie nichts geschrieben hat (`if (!food) return;`, `index.ts:453`, Upsert-Fehler nur geloggt, `index.ts:480`).

**Wie der User es merkt:** Im Gym bei wackligem Netz ein Suchergebnis loggen. Ab dem nächsten Flush bleibt der Sync-Status dauerhaft rot, kein Workout, kein Set, kein Health-Eintrag wird mehr bestätigt. Beim Sign-out muss er den Warn-Dialog wegklicken und verliert alles seit dem letzten erfolgreichen Sync.

**Fix:** In `confirmLogFood` `ensureFoodCached` genauso awaiten wie in `toggleFavorite` und bei `false` die Zeile mit `foodId: null` stagen (die Makros sind ohnehin denormalisiert, der FK ist rein informativ). Zusätzlich in `syncStore` 23503 auf `zane_food_logs` abfangen und die betroffenen Zeilen mit `food_id: null` nachschreiben, damit ein einzelner Cache-Miss nie den ganzen Loop wedged. Die Edge Function darf bei nicht geschriebener Cache-Zeile nicht `{ ok: true }` antworten.

---

### C2 [critical/data-loss] Backup-Import multipliziert alle Gewichte mit 2,20462, wenn die aktive Einheit `mixed` ist

**Datei(en):** `src/screens-settings.jsx:1269-1283`, Wirkung in `src/store.js:495-503,349`

**Was passiert:** `runImport` vergleicht die rohen unit-Strings statt der Gewichtsachse. Für einen Nutzer mit `settings.unit === 'mixed'` (kg-Gewicht, mi-Distanz) meldet die Erkennung bei einem kg-Backup `srcUnit='kg'`, `userUnit='mixed'`, also `unitMismatch === true`, und der Import läuft mit multiplier 2.20462 über alle `sets[].kg`, obwohl beide Seiten kg sind.

**Warum:** `const unitMismatch = srcUnit !== userUnit;` (1277) und `unitConvert = unitMismatch ? { multiplier: srcUnit === 'kg' ? 2.20462 : 1 / 2.20462, targetUnit: userUnit } : null` (1281-1283). Es gibt keine Normalisierung der Gewichtsachse, obwohl `mixed` ein real erreichbarer dritter Wert ist (Signup-Picker `screens-home.jsx:274`) und auf der Gewichtsseite kg bedeutet (`app.jsx:1559-1564`: `window.__UNIT = (_u === 'lbs') ? 'lbs' : 'kg'`). `store.js:349` schreibt danach `unit: unitConvert?.targetUnit ?? sett.unit`, also wieder `mixed`, die Zahlen werden also weiter als kg angezeigt.

**Wie der User es merkt:** Unit steht auf Mixed, er spielt sein eigenes älteres kg-Backup zurück. Der Confirm-Text sagt "Weights will be converted from KG to MIXED", er bestätigt. Aus 100 kg Kniebeuge werden 220,5 kg, in der gesamten Trainingshistorie, ohne Rückweg, weil `deleteAllData` das Original vorher gelöscht hat.

**Fix:** Beide Seiten vor dem Vergleich auf die Gewichtsachse normalisieren: `const weightAxis = u => (u === 'lbs' ? 'lbs' : 'kg');` und `unitMismatch` sowie den Multiplikator daraus bilden. `targetUnit` bleibt die echte User-Unit fürs settings-Feld. Zusätzlich `detectedUnit === 'mixed'` in der Auto-Erkennung als kg behandeln.

**Nebenbefund derselben Familie (medium, siehe M28):** Auch bei einem echten kg→lbs-Import werden nur `sets[].kg` konvertiert, nicht Körpergewicht, Increments, Equipment-Limits, Meso-Boosts und 5/3/1-TMs.

---

### C3 [critical/data-loss] Backup-Restore löscht serverseitig alle Food-Logs älter als 30 Tage

**Datei(en):** `src/store.js:765-769` (Export), `src/store.js:243,444,564-579` (Import), `src/store.js:903,973,848` (Fenster)

**Was passiert:** `exportBackup` reicht `store.foodLogs` per `...rest` durch, obwohl diese Collection beim Boot auf 30 Tage gefenstert ist. `importFromBackup` löscht über `deleteAllData` aber **alle** `zane_food_logs`-Zeilen des Users und spielt nur die im Backup enthaltenen zurück.

**Warum:** `loadFromSupabase` fenstert hart (`foodHistCutoff = historyWindowCutoffISO(new Date(), FOOD_HISTORY_WINDOW_DAYS)` mit `FOOD_HISTORY_WINDOW_DAYS = 30`, `.gte('date', foodHistCutoff)`). `exportBackup` lädt **nur** die Session-Entries ungefenstert nach (`store.js:738`), für foodLogs gibt es keinen Nachlade-Fetch. `deleteAllData` führt `unwrap(_supabase.from('zane_food_logs').delete().eq('user_id', userId))` ohne Datumsfilter aus. Dass die alten Zeilen echte, erreichbare Daten sind, belegt `fetchFoodLogsForDates` (`store.js:2810`), das sie für Health-Datepicker und CSV-Export nachlädt. Bei den Session-Entries ist genau diese Falle bewusst vermieden worden, bei foodLogs nicht.

**Wie der User es merkt:** Er trackt seit 12 Monaten Essen, exportiert ein Backup, spielt es später beim Gerätewechsel zurück. 11 Monate Food-Historie sind serverseitig weg, ohne Fehlermeldung. Der Confirm-Text ("Your current data will be permanently replaced") suggeriert nur einen Austausch gegen den Backup-Inhalt.

**Fix:** In `exportBackup` die Food-Logs analog zu den Session-Entries ungefenstert nachladen und explizit als `foodLogs:` ins Backup-Objekt schreiben, Fehler hart werfen wie bei `entriesRes.error` (`store.js:753`). Generell: jede gefensterte Store-Collection braucht im Export einen Nachlade-Fetch. Ein Check, der gefensterte Collections gegen den Export prüft, verhindert die Wiederholung.

---

### H1 [high/data-loss] `loadData`-Hintergrundmerge ohne uid-Guard: In-Session-Accountwechsel mischt zwei Accounts

**Datei(en):** `src/app.jsx:760-1002`

**Was passiert:** Der Hintergrund-Refresh prüft nie, ob `uid` noch der aktuelle Nutzer ist. Löst `loadFromSupabase(A)` erst auf, nachdem in derselben Seiten-Session bereits Nutzer B geladen wurde, mergt der Callback A's Serverdaten in B's Store, setzt `syncBase.current` auf A's Daten und ruft `setStore(merged)`.

**Warum:** Zeile 760 startet `LB.loadFromSupabase(uid).then(fresh => { const cur = prevStore.current; ... })` und schreibt über die ganze Kette (776 `syncBase.current = diffBase`, 777 `LB.saveBase(diffBase, uid)`, 999-1000 `prevStore.current = merged; setStore(merged)`) ohne jeden `uid !== userIdRef.current`-Check. Auch `.catch(console.error)` (1002) und der else-Zweig nach dem await (1006-1014) haben ihn nicht. Die Gegenbeispiele stehen wörtlich in derselben Datei: `flushSync` Zeile 683, `flushBeforeSignOut` Zeile 722. Der In-Session-Wechsel ist real: `SIGNED_OUT` (1057-1082) macht `setStore(null)`/`setPhase('unauthed')` ohne Reload, `SIGNED_IN` (1033-1048) räumt retryTimer und pendingStore auf, aber nicht die laufende Load-Promise.

**Wie der User es merkt:** A meldet sich bei langsamer Verbindung ab, B loggt sich auf demselben Gerät ein. B sieht A's Übungsbibliothek, Pläne und Trainingshistorie. Der Sync-Effekt persistiert diesen Mischzustand per `saveToLocal(merged, B)` in B's lokalen Cache. Serverseitig ist der Schaden milder (der Diff gegen A-fresh schreibt identische Zeilen nicht in B's Account), lokal und in der Anzeige ist es ein echter Cross-Account-Leak.

**Fix:** Am Anfang des `.then`-Callbacks, im `catch` und nach dem await im else-Zweig denselben Guard wie in `flushSync` setzen: `if (uid !== userIdRef.current) return;`. Zusätzlich einen Generation-Counter (`loadSeq`), damit auch zwei Loads desselben Users nicht überkreuz landen.

---

### H2 [high/sync] Boot-Merge lässt stale lokale Settings gewinnen und schreibt sie über den frischen Serverwert

**Datei(en):** `src/app.jsx:959` (Merge), `src/store.js:1906,1967,1989-2025` (Write)

**Was passiert:** Für alle Settings-Keys außer `WATER_SYNC_KEYS` und den Plan-Position-Feldern gewinnt im Boot-Merge blind der lokale Cache, obwohl der Diff-Base auf den Serverstand gesetzt wurde. Der unmittelbar folgende Post-Boot-Flush erkennt die Differenz als lokale Änderung und schreibt den stale Wert per `zane_user_settings`-Upsert über den frischen Serverwert.

**Warum:** `const mergedSettings = { ...fresh.settings, ...cur.settings, ...(fresh.settings.unit == null ? { unit: null } : {}) };` lässt den lokalen Cache für jeden Key gewinnen. Die base-aware Korrektur `if (!localUnsynced) mergedSettings[k] = fresh.settings?.[k];` (960-963) greift nur für die 10 Keys in `WATER_SYNC_KEYS`. Vorher wird `syncBase.current = diffBase` auf den reinen Serverstand gesetzt (776). Nach `setStore(merged)` feuert der Store-Effekt `flushSync`, in `syncStore` triggert z.B. `JSON.stringify(prev.settings?.macroTargets) !== JSON.stringify(next.settings?.macroTargets)` den settingsChanged-Zweig, und `macro_targets: next.settings?.macroTargets ?? null` geht ungegatet mit raus. Betroffen: macroTargets, macroCalc, mealWindows, sessionTimeoutMinutes, defaultCheckinSchema, hiddenHealthCards, planMode, equipmentConfig, restDefault/Big/Medium/Small.

**Wie der User es merkt:** Er setzt am Handy neue Makro-Ziele, öffnet danach die App am Desktop mit altem Cache. Der Desktop schreibt die alten Ziele zurück. Die am Handy gesetzten Ziele sind serverseitig überschrieben und verschwinden beim nächsten Handy-Boot ebenfalls. Analog für ein per `pushMealPlanToClient` gesetztes `plan_mode` oder ein am Zweitgerät geändertes `sessionTimeoutMinutes`.

**Fix:** Die base-aware Regel umdrehen: Default für alle Settings-Keys `if (base && JSON.stringify(cur.settings?.[k]) === JSON.stringify(base.settings?.[k])) mergedSettings[k] = fresh.settings?.[k];`, mit expliziter Opt-out-Liste für echte Geräte-Settings (darkMode, accentColor, swVersion, cycleWeekView). Alternativ die betroffenen Spalten in `syncStore` genauso gaten wie `store.js:1989-2025` es für Plan-Position und Water tut.

Verwandt im alten Report: "[data] Settings upsert always sends multi-device sensitive scalars". Der dortige Fix hat nur die dokumentierten Gates in 1989-2025 gebracht, das Merge-Problem selbst ist offen.

---

### H3 [high/data-loss] Status-Picker auf einem vergangenen Tag löscht die aktuell offene Sick/Vacation-Periode

**Datei(en):** `src/screens-health.jsx:3265-3290`, Einstieg `:2668,:1270,:3801`

**Was passiert:** `handleSetStatus` behandelt jeden Picker-Tap als Änderung des **heutigen** Status, auch wenn er auf dem Log eines vergangenen Tages passiert.

**Warum:** `const openPeriod = mode === null ? (store.statusPeriods || []).find(p => !p.endedAt) : null;` (3265) und `const shouldDelete = !!openPeriod && closedAt < openPeriod.startedAt;` (3266). Der Write-Pfad ist `.delete().eq('user_id', userId).is('ended_at', null)` (3287), trifft also die aktuell offene Periode, nicht die historische Periode des bearbeiteten Tages. `current` ist `store.statusMode` (heute), nicht `dayMode` (der Tag). `DailyLogScreen` ist für vergangene Tage voll erreichbar, `HealthDateStrip` gated nur die Zukunft (`const selectedIsFuture = selectedDate > today;`, 2668). Der Gegenweg ist genauso kaputt: "Sick" auf einem vergangenen Tag fällt in den else-Zweig `LB.updateStatusPeriodStart(userId, startedAt)` (3290) und zieht den Start der laufenden Periode zurück.

**Wie der User es merkt:** Er ist heute als Sick markiert und will einen alten Tag korrigieren, tippt dort "Normal". Die heutige Sick-Periode wird dauerhaft aus der DB gelöscht, `statusMode` wird null, der alte Tag bleibt unverändert. Kein Dialog, kein Undo.

**Fix:** Zwei Fälle trennen. Für `startDateStr < todayISO` die Periode des bearbeiteten Tages gezielt über ihre `id` ändern (`.eq('id', period.id)`) statt `.is('ended_at', null)`, und `statusMode`/`statusModeSince` nur schreiben, wenn der bearbeitete Tag in die offene Periode fällt. Minimalabsicherung, falls Historien-Bearbeitung gar nicht gewollt ist: `shouldDelete` zusätzlich an `startDateStr >= openPeriod.startedAt.slice(0,10)` binden und den Picker für Tage außerhalb der offenen Periode read-only rendern.

---

### H4 [high/bug] Cycle-Mode Day-Import erzeugt zwei Days mit identischer `id` im selben Plan

**Datei(en):** `src/screens-schedule.jsx:2572` (Handler), `:3116-3120` (Props), `:3167-3169,3278,3284` (Picker)

**Was passiert:** Der Pfad `+ Add day` → `↩ Import day with history` übernimmt die id des Quell-Days ungeprüft, auch wenn der Quell-Plan der gerade editierte Plan ist.

**Warum:** `DayTypePicker` rendert `DayCopyPicker` mit `schedule={null} currentDayId={null}`. Damit ist `const isSamePlan = selectedPlan.id === schedule?.id` immer `false`, also liefert `migrateId = isSamePlan ? undefined : d.id` immer die Quell-Day-id. Die Planliste filtert den editierten Plan nicht heraus und bewirbt ihn sogar mit dem Badge `↩ history`. Der Handler schreibt `days: [...d.days, { id: migrateId || LB.uid(), name: day.name, items }]` ohne Kollisionsprüfung. Beide Schwester-Pfade haben genau diesen Guard: Weekday-Import `const collides = d.days.some(x => x.id === pendingImportDay.migrateId); const id = (pendingImportDay.migrateId && !collides) ? pendingImportDay.migrateId : LB.uid();` (2610-2611) und `DayEditor.copyItemsFromDay` (3804-3805).

**Wie der User es merkt:** Nach dem Import zeigt der neu angehängte Day den Inhalt des alten (weil `draft.days.find(d => d.id === editingDay)` auf die erste Kopie auflöst). Beim Speichern ersetzt `days.map(x => x.id === editingDay ? updated : x)` **beide** Days durch denselben Inhalt, der Inhalt des anderen Days ist weg. React rendert zusätzlich zwei Elemente mit identischem `key`, und geloggte Sessions referenzieren `day_id`, womit die Historie nicht mehr eindeutig zuzuordnen ist. Derselbe Effekt entsteht beim zweimaligen Import desselben Fremd-Days.

**Fix:** Im `onImport`-Handler denselben Guard einsetzen: `const collides = d.days.some(x => x.id === migrateId); const id = (migrateId && !collides) ? migrateId : LB.uid();`. Zusätzlich das echte `schedule` an `DayTypePicker` und weiter an `DayCopyPicker` durchreichen, damit `isSamePlan` greift.

---

### H5 [high/data-corruption] Chain-Techniken lassen auf unilateralen Übungen stale `repsL`/`repsR` stehen

**Datei(en):** `src/screens-train.jsx:1781-1794,1859-1872,1929-1942`, Gegenprobe `src/screens-lib.jsx:4648-4655`

**Was passiert:** `finishDropSet`, `finishMyoSet` und `finishAv` committen die Chain-Runden als `kg`/`reps`, lassen aber die vom Seed vorbelegten `repsL`/`repsR` stehen. Da `LB.effReps` L/R gegenüber `reps` immer bevorzugt, rechnen ab da Volumen, PR-/e1RM-Erkennung und der Meso-Rep-Outcome mit den Seed-Reps.

**Warum:** Alle drei Finisher schreiben nur kg/reps/done/technique/drops, kein `repsL: null, repsR: null`. Der Schwester-Pfad im Session-Editor macht es korrekt und dokumentiert dabei fälschlich, der Live-Logger tue dasselbe: `return { ...st, technique: techId, drops, kg: drops[0].kg, reps: drops[0].reps, repsL: null, repsR: null };` mit Kommentar "matching the shape the live logger writes". `buildSeedSets` (`store.js:2551ff`) füllt für `isUni` immer repsL/repsR, der INTENSITY-Button ist für unilaterale Übungen offen (`screens-train.jsx:7183` gated nur auf `!isCardio && !isTime && !isCheckbox`), im Intensity-Sheet gibt es keinen Unilateral-Guard. `effReps` (`store.js:2175-2180`) bevorzugt L/R, `entryVolume` (`store.js:2344`) und `prValOf` (`screens-train.jsx:1081-1083`) rechnen darüber.

**Wie der User es merkt:** Unilaterale Übung, Seed 40 kg L10/R10. Er loggt einen Drop-Set mit 40x6 und 30x5. Gespeichert wird kg 40, reps 6, repsL 10, repsR 10. Volumen rechnet 40x10, der e1RM 54,7 statt 48, und es kann ein PERSONAL-RECORD-Stempel gesetzt werden, den es nie gab. Die Set-Zeile zeigt weiterhin L10/R10.

**Fix:** In allen drei Finishern `repsL: null, repsR: null` mit in den Set-Patch. Bestandsdaten brauchen eine Migration: repsL/repsR auf null, wo `technique` in ('drop','myorep','myorep_match','amrap_variations') und `drops` ein Array ist.

---

## Mittel

Kompakt, gruppiert nach Bereich. Alle bestätigt mit Zeilenbeleg.

**Store / App-Shell (`src/app.jsx`, `src/store.js`)**

- **M1 `softRefresh` ohne base-Guard reanimiert serverseitig gelöschte Zeilen** (`app.jsx:458-519`, drei Scans unabhängig gefunden). Allen sechs `localOnly*`-Filtern fehlt der base-Membership-Test, den der Boot-Merge hat (`!serverIds.has(id) && !baseIds?.has(id)`). Auf einem anderen Gerät gelöschte Glucose-, Water-, Food- oder Cardio-Einträge kommen beim Foreground-Refresh zurück; nach dem stündlichen `collapse_water_logs`-Cron zählt der Wasserstand des Vortags doppelt (6 Rohzeilen plus Summary-Zeile). Fix: `const base = syncBase.current;` weiter oben ziehen (die Variable existiert bereits ab 468) und die Id-Sets bilden.
- **M2 `intentionalSignOut`-Latch wird nach fehlgeschlagenem `signOut` nie entschärft** (`app.jsx:746`). Latch ohne Ablauf und ohne Reset außerhalb des SIGNED_OUT-Handlers. Bei GoTrue 5xx bleibt es für die Seiten-Session auf true, der nächste unfreiwillige SIGNED_OUT gilt als beabsichtigt und wischt den lokalen Pending-Diff. Fix: Timestamp statt Boolean, plus Reset in SIGNED_IN/INITIAL_SESSION.
- **M3 Realtime-Reload überschreibt `anyClientLive`/`pendingCheckinsCount`** (`app.jsx:1298`). `reloadCoachingState` liefert diese Felder nicht, der 60-s-Poll stellt sie wegen seines Memo-Guards nicht wieder her. Der Live-Punkt und das Check-in-Badge am Coaching-Tab verschwinden bis zum nächsten echten Wertwechsel.
- **M4 `nextReminderAt`-Effekt: Dep-Array deckt `schedules`/`sessions` nicht ab** (`app.jsx:1435-1442`). Verschiebt der Nutzer seinen Trainingstag im Plan-Editor, bleibt der gespeicherte Reminder-Zeitpunkt auf dem alten Tag stehen.
- **M5 CARDIO-Dedup entscheidet anhand gefensterter Session-Entries** (`app.jsx:366`). Entries sind für Sessions außerhalb der 70 Tage leer, ohne Treffer gewinnt `cardioExes[0]`, meist die neu geseedete Zeile. Die real referenzierte Zeile wird serverseitig gelöscht.
- **M6 `reloadCoachingState` verliert beide `support_`-Filter** (`store.js:4132-4164`). Bei einem User mit echtem Coach **und** offenem Support-Ticket matcht `.maybeSingle()` zwei Zeilen, liefert PGRST116, der Fehler wird ignoriert, und `checkinEnabled` fällt auf true zurück. Der vom Coach pausierte Check-in-Toggle springt zurück.
- **M7 `mergeSessions` verwirft nie gesyncte beendete Sessions älter als 2 Tage** (`store.js:3783`). Bei vorhandener Base ist die Datumsschranke nicht redundant, sondern löscht genau die Sessions, die es serverseitig nirgends gibt. Schlägt direkt in C1 ein. Fix: `(baseIds ? !baseIds.has(x.id) : (x.date || '') >= cutoffISO) && x.ended != null`, plus Test in `tools/test/store.test.cjs`.
- **M8 Rest-Timer-Wert 0 wird nie gespeichert und nie angewendet** (`store.js:1285-1288,1939-1942,350-353` und `screens-settings.jsx:2573`, `screens-train.jsx:2514-2517`). Der Stepper lässt `min={0}` zu, `||` zwingt überall auf den Default zurück; `screens-lib.jsx:1030` interpretiert 0 dagegen korrekt. Fix: `??` statt `||`, oder `min` auf 1 setzen.
- **M9 Einheiten-Import konvertiert nur Set-Gewichte** (`store.js:495`). Nicht konvertiert: `dailyLogs.weight`, `exercises.progression_increment`, `settings.equipmentConfig[*].increment`/`.maxKg`, `mesoStates.weightBoosts`/`weightBoostDeclines`, 5/3/1-TMs in `schedules`. Nach einem kg→lbs-Import zeigt der Gewichtsverlauf 82 statt 181 und ein 5/3/1-Plan rechnet mit falschem TM.
- **M10 FK-Reihenfolge fehlt für Food-Writes** (`store.js:1696,2032`). `zane_food_logs` (mit FK `recipe_id`) steht im selben `Promise.all` vor `zane_food_recipes`. Neues Rezept plus Rezept-Log im selben Diff kann 23503 werfen, mit derselben Wedge-Wirkung wie C1.
- **M11 Löschen eines Daily Logs greift ins Leere bei abweichender Server-Id** (`store.js:1861`). Geschrieben wird per RPC mit Konfliktziel `(user_id, date)`, gelöscht per id. Weichen die Ids auseinander, löscht `delete().in('id', [...])` nichts, ohne Fehler.

**Schedule (`src/screens-schedule.jsx`)**

- **M12 `doSave` verletzt die dokumentierte `days === versions[0].days`-Invariante** (`:2083`). `dedupeVersionsByDate` (`store.js:3503-3512`) sortiert newest-first, der neue Eintrag ist also nicht zwingend Index 0, `savedDraft.days` zeigt aber weiter auf ihn. Der nächste nicht-strukturelle Save überschreibt dann die geplante Zukunftsversion. Fix: in beiden Zweigen über `LB.withVersionedDays(draft, versions)` gehen.
- **M13 Weekday-Pläne: Day-Typ- und Import-Änderungen gelten als nicht-strukturell** (`:2177`). Die Prüfung erkennt nur Hinzufügen/Entfernen von Wochentagen. Ein geänderter Day-Typ oder ein per Import ausgetauschter Day (inkl. id-Wechsel) löst keinen Versions-Prompt aus und wirkt rückwirkend auf die Historie.
- **M14 "See the full guide" verliert `versionFrom` und verwirft laufende Versions-Edits** (`:2996`). Fix: `back: { name: 'schedule-edit', scheduleId, versionFrom }` mitgeben und die Navigation durch dasselbe Dirty-Confirm schicken wie den TopBar-Back.
- **M15 Backup-Liste schluckt den Supabase-Fehler und zeigt "No backups yet"** (`:568`). Offline oder bei RLS-Fehler behauptet das Sheet, es gebe keine Wiederherstellungspunkte. Kein Retry im Sheet.

**Train / Lib**

- **M16 `currentSetIdx` ignoriert `skipped`** (`screens-train.jsx:5695`). Nach "Skip remaining sets" und Rückkehr zur Übung rendert die Hero-Card einen übersprungenen Set voll editierbar, während die Listenzeile ihn sperrt und der Footer-Button deaktiviert ist. Was der Nutzer dort eintippt, fällt aus Volume und PR heraus. Fix: `entrySets.findIndex(s => !s.done && !s.skipped)` (identisch zu 5571/2114/7342).
- **M17 Offenes `lpTarget`/`wsTarget` blockiert das Auto-Arming für den Rest der Session** (`screens-train.jsx:5576`). Der Guard ist pauschal statt auf die aktuelle Übung beschränkt. Verlässt der Nutzer die Übung ohne FINISH/CANCEL, bekommt keine weitere Übung mehr ihre plan-vorgeschriebene Technik.
- **M18 Library "Recent" zeigt den ersten Warm-up-Satz als letzten Satz** (`screens-lib.jsx:401`). Der Filter schließt `warmup` nicht aus, bei Sessions mit Warm-up-Ramp erscheint der 30-%-Satz. Fix: `find(s => s.kg != null && !s.warmup && !s.skipped)`.
- **M19 `SessionEditSheet` kann Time-/Checkbox-Sätze nicht darstellen oder bearbeiten** (`screens-lib.jsx:4828`). Für Time-Übungen ist `st.timeSec` im Editor unerreichbar, für Checkbox-Übungen werden zwei sinnlose kg/reps-Felder angeboten.
- **M20 Übungs-Löschung räumt `workoutTemplates` nicht auf** (`screens-lib.jsx:201`). Home-Freestyle zeigt weiter "Push A · 8 ex", die Preview listet 2. Fix wie bei `schedules` mitstrippen.

**Health / Food**

- **M21 Ändern der Makroziele schreibt die Adhärenz-Historie rückwirkend um** (`screens-health.jsx:3400`). Der Food-Reconcile-Effect hat `effectiveTargets` in den Dependencies und rescored alle Tage mit Food-Einträgen, entgegen dem dokumentierten Save-Time-Snapshot-Contract von `targetsSnap`.
- **M22 Fehlgeschlagene Glukose-/BP-/Temperatur-Writes rollen still zurück** (`screens-health.jsx:1057` u.a., sechs Pfade). `{ error }` wird korrekt geprüft, der optimistische Update aber kommentarlos zurückgerollt. Diese drei Collections sind nicht Teil des `syncStore`-Diffs, es gibt also keinen Offline-Retry: die Messung ist weg, ohne dass der Nutzer es merkt.
- **M23 `patchDaily` nullt `targetsSnap` und verwirft den Flex-Plan Training|Rest-Override** (`screens-food.jsx:1198`). Health-Save und Food-Reconciler haben für genau diesen Fall einen Guard (`screens-health.jsx:1155-1158`), `patchDaily` nicht.
- **M24 Teilen aus dem Edit-portions-Sheet überschreibt den Rezept-Share unter demselben Token** (`screens-food.jsx:3681`) mit einer degradierten Rekonstruktion ohne `calories`, `foodId`, `brand`, `source`. Der Empfänger eines bereits verschickten Links sieht plötzlich die kaputte Version.

**Coaching**

- **M25 `CoachingPendingBanner` ersetzt den halben Store durch einen rohen `loadFromSupabase`-Snapshot** (`screens-coaching-core.jsx:150`) und umgeht die komplette Merge-Pipeline aus `app.jsx`. Offline angelegte, noch nicht gesyncte Einträge verschwinden beim Annehmen einer Einladung. Fix: über `LB.reloadCoachingState(userId)` gehen und nur `coaching` ersetzen.
- **M26 Check-in-Trendkarte zeigt bei Choice-Feldern ein Options-Label als Delta** (`screens-coaching-detail.jsx:349`). Delta 1 rendert als "Improved", Delta 2 als "Same". Der Coach liest im Delta-Slot einen Wert, der nichts mit der Differenz zu tun hat.

**Settings**

- **M27 `handleDeleteAll` setzt `markIntentionalSignOut` vor einem werfenden await und fängt nichts ab** (`screens-settings.jsx:1625`). Bricht das Netz während `deleteAllData` weg, ist der Account teilweise gelöscht, `signOut()` wird nie erreicht, der Nutzer sieht nur das rohe Debug-Overlay aus `index.html:569-573`, und das Latch bleibt scharf (siehe M2).
- **M28 `exportData` hat keine Fehlerbehandlung** (`screens-settings.jsx:1252`). Der bewusste "fail loudly"-Throw in `exportBackup` verpufft, weil der Aufrufer ihn nicht behandelt. Schritt 1 des Restore-Flows (das Sicherheitsnetz) kann still fehlschlagen, der destruktive Schritt 2 bleibt trotzdem freigeschaltet. Zusammen mit C2 und C3 ist das der Grund, warum der Restore-Pfad die Top-Priorität hat.
- **M29 `#0a0a0a` hart auf dem Accent-Fill der beiden Recovery-Buttons** (`app.jsx:70` und `:279`). In Light und Paper ist `--accent` ein dunkler Fill und `--accent-ink` `#f5f5f5`; der einzige Ausweg-Button auf ErrorBoundary und ErrorScreen wird damit fast unlesbar. Nebenbefund: die beiden rollengleichen Buttons haben Radius 8 vs 4.

**Backend / Tooling**

- **M30 `collapse_water_logs`: nur REVOKE FROM PUBLIC, `authenticated` behält EXECUTE** (`supabase/migrations/0183_water_log_collapse.sql:85`). SECURITY DEFINER, arbeitet über alle Tenants. Jeder eingeloggte User kann `supabase.rpc('collapse_water_logs')` aufrufen und für alle User die Rohzeilen falten. Doku und Code-Kommentar behaupten das Gegenteil. **Bereits im alten Report**, weiterhin real; die fertige Migration liegt als Entwurf unter `docs/grok/migs/0213_collapse_water_logs_revoke.sql` und muss nur nach `supabase/migrations/` übernommen werden.
- **M31 Coach-schreibbare Food-Tabellen ohne `zane_guard_user_id`-Trigger** (`supabase/schema.sql:2442`). `zane_food_meal_plans`, `zane_food_template_slots`, `zane_food_recipes` wiederholen das RLS-Muster, gegen das Migration 0148 den Trigger eingeführt hat. Ein Coach kann per UPDATE die `user_id` einer Client-Zeile auf sich selbst oder einen anderen Client umhängen.
- **M32 RLS: Client darf `checkin_enabled` und `checkin_schema` überschreiben** (`supabase/schema.sql:589`). Die Policy "client can respond to invite" erlaubt jede Spalte, `zane_coaching_guard_update` schützt nur coach_id, client_id und status.
- **M33 `auto-close-sessions` und `reminder` fehlt der `!res.ok`-Guard nach `dbFetch`** (`supabase/functions/auto-close-sessions/index.ts:61`). Die Fallbacks `[]`/`[null]` suggerieren eine Absicherung, die es nicht gibt; bei non-2xx wirft die Iteration einen TypeError, den `run().catch(...)` schluckt. `water-reminder/index.ts:77` hat den Guard bereits.
- **M34 `auto-close-sessions` und `zane_coaching-notify` ignorieren `use_pushover`** (`.../index.ts:142` bzw. `:78`) und senden Pushover **und** Web Push. Für die drei Reminder-Functions wurde genau das als Bug abgestellt.
- **M35 Food-Tagesquota zählt auch `select` und `cache` als Suche** (`supabase/functions/search-foods/index.ts:493`). Beim Loggen fallen bis zu drei Einheiten an, der Favoriten-Repair-Effekt feuert pro Screen-Mount eine Einheit je unreparierter Favorite, und bei 429 wiederholt sich der Effekt endlos. Das Limit ist als "400 food searches" formuliert.
- **M36 `bake-feature-map` bumpt `sw.js`, lässt die `?v=`-Buster der Public-Seiten stehen** (`tools/bake-feature-map.cjs:168`). Der Push triggert `check.yml`, `check-cache-version.cjs` schlägt fehl, und `features.html` serviert weiter den alten Katalog. Die HTML-Dateien werden vom Workflow gar nicht committet.
- **M37 `src/exercise-db.js` und `src/autoreg-guide-page.js` laufen am CI-Syntax-Gate vorbei** (`tools/check-syntax.cjs:27`). Zwei ausgelieferte Plain-Scripts ohne jedes CI-Signal. Ein Syntaxfehler beim Ergänzen einer Katalog-Übung geht grün durch und lässt `window.SYSTEM_EXERCISES` undefined. Fix: beide in `plainSources`, `exercise-db.js` zusätzlich in `globalScopeSources` (Zeile 51), damit auch Namenskollisionen im geteilten Scope auffallen.
- **M38 Em-Dashes flächendeckend im ausgelieferten App-Text.** ~137 Zeilen in `src/whatsnew.js` (inklusive mindestens eines Eintrags-Titels), plus `app.jsx:120` (Auto-Close-Banner), `screens-home.jsx:412,2651-2652,2831,2858`, `screens-health.jsx:3300-3301` (wird zusätzlich als Chat-Nachricht verschickt), `screens-onboarding.jsx:2559`, `screens-cardio.jsx`, `screens-lib.jsx`, `screens-schedule.jsx`, `screens-settings.jsx`. Repo-weit 1082 Treffer in `src`, davon der überwiegende Teil in nicht-sichtbarem Kontext, aber der user-visible Anteil ist dreistellig. Das ist die einzige als absolut formulierte Hausregel, die systematisch verletzt ist. Achtung beim Batch-Replace: das Leerwert-Platzhalter-Glyph (U+2014 als alleinstehender Platzhalter für "kein Wert", z.B. in `screens-coaching-client.jsx` um Zeile 600) ist Absicht und darf nicht mitersetzt werden.

---

## UI-/UX-Inkonsistenzen

Gruppiert nach Muster, mit Anzahl der Fundstellen.

**Muster 1: Design-System-Primitives werden umgangen (5 Stellen)**

- `screens-coaching-client.jsx` und Nachbarn: **40 native `alert()`-Aufrufe** neben dem vorhandenen gestylten Alert-Modus von `useConfirm`. Zwei Fehlerpfade derselben Funktionsgruppe in derselben Datei melden denselben Import-Fehler auf zwei völlig verschiedene Arten (Browser-Dialog vs. Bottom-Sheet).
- `screens-coaching-core.jsx:179,184,693` und `screens-coaching-detail.jsx`: handgebaute Primary-Buttons mit flachem `var(--accent)`-Fill statt `Btn`/`btnPrimary`, zwei davon mit Radius 8 statt der Button-Stufe 6.
- `screens-coaching-core.jsx:688` (Radius 8), `screens-coaching-detail.jsx:1753` (Radius 6): Eingabefelder haben im Coaching drei verschiedene Radien, obwohl die Input-Stufe 4 ist und `-detail:542`/`-tabs:1140` sie korrekt verwenden.
- `screens-schedule.jsx:2792` und drei weitere: **vier handgebaute Toggles** mit abweichendem Off-Zustand (Track `UI.hairStrong` statt `UI.bgInset`, Knopf 20px statt 18px, hartes `'#fff'` statt `UI.inkFaint`).
- `app.jsx:70`/`:279`: Recovery-Buttons mit hartem `#0a0a0a` und Radius 8 vs 4 (siehe M29).

**Muster 2: Akzentfarbe / Theme-Tokens nicht durchgezogen (2 Stellen)**

- `features.html:19`: `--accent-rgb` existiert nur im `:root`-Block mit dem Dark-Wert `201,169,97`, während derselbe Block `--accent:#9a7b34` (Light) setzt. Kein Theme-Block korrigiert das Tripel, im Light-Mode mischt die Seite zwei Golds.
- `app.jsx:70`/`:279`: siehe oben, `#0a0a0a` statt `var(--accent-ink)`.

**Muster 3: Einheiten-Labels nicht über `UI.unit()` (3 Stellen)**

- `screens-onboarding.jsx:2259` und zwei weitere Tour-Visuals: hartes `' kg'`, obwohl dieselbe Datei sonst durchgehend `UI.unit()` benutzt. Für lbs-Nutzer widersprechen sich die Slides derselben Beispielperson.
- `screens-health.jsx:2468`: In der read-only Coach-Ansicht sind Gewicht, Glukose und Temperatur bewusst in Client-Einheiten gelabelt, Wasser läuft über `UI.waterSummaryValue()`/`UI.waterSummaryUnit()` und damit über `window.__UNIT`, also die Einheit des **Coaches**.
- `screens-train.jsx:1593`: Smart Progression schlägt lbs-Nutzern ohne konfiguriertes Increment +2,5 lbs vor (kein üblicher Sprung), der Meso-/Autoreg-Pfad derselben Datei vergibt korrekt +5 lbs.

**Muster 4: Ein Screen widerspricht seinem Schwester-Screen (5 Stellen)**

- `screens-health.jsx:1034`: `saveGlucose` verwirft ungültige Eingaben still, BP und Temperatur im selben Sheet zeigen "Invalid reading".
- `screens-train.jsx:1174`: lokale Shadow-Varianten von `isImprovement`/`isDecline` ohne die time- und reps-only-Zweige der geteilten `LB.`-Versionen.
- `screens-food.jsx:5199`: `recentPicks` im Zutaten-Picker sortiert nicht nach (date, time), `recentFoodsAll` im Food-Tab tut es und dokumentiert warum.
- `screens-food.jsx:4008`: zwei unabhängige React-States auf dem gemeinsamen localStorage-Key `logbook-label-scanner-provider`, die nach einer Umstellung dauerhaft auseinanderlaufen (`FoodTemplateScreen` bleibt gemountet).
- `screens-food.jsx:1567`: `submitCopyMove` klont `templateSlotId` und `splitBatch` mit, entgegen der Regel in `submitRepeatYesterday`. Der Slot-Marker lässt Auto-Fill den Template-Slot am Zieltag als erledigt behandeln.

**Muster 5: Anzeige stimmt nicht mit dem zugrundeliegenden Zustand überein (4 Stellen)**

- `screens-lib.jsx:2275` StatsTab "Top Exercises": `?`-Zeilen für gelöschte Übungen, die sich wie Links anfühlen und beim Tippen zurückspringen.
- `screens-food.jsx:2585` Meal-of-Choice-Sheet: nach dem Abhaken bleiben Uhrzeit und Name editierbar, ein Save ändert aber nur `dailyLogs.mealOfChoiceHour` und den Off-Plan-Note-Namen, nicht `time`/`foodName` des bestätigten Eintrags.
- `screens-settings.jsx:1634` "Coaching tab"-Toggle: bei aktiver Beziehung ein toter Schalter (Zustand aus `hasCoaching` abgeleitet, springt zurück) mit dem versteckten Seiteneffekt, `beYourOwnCoach` auf false zu setzen, ohne die Self-Coaching-Beziehung zu beenden.
- `screens-onboarding.jsx:1063` Tour-Mockup "Skip Remaining Sets" erfindet eine EXERCISES-Schaltfläche im Trainings-Footer und beschriftet den Skip-Button anders als die App.

**UX: Sackgassen und destruktive Defaults (6 Stellen)**

- `screens-train.jsx:5627` Readiness-Sheet ist unverlassbar (`onClose={() => {}}`, kein Skip-Control, Confirm ohne Auswahl deaktiviert), entgegen dem eigenen Kommentar.
- `screens-train.jsx:8265` Backdrop-Tap auf dem Plan-Diff-Sheet nimmt stillschweigend den destruktiveren "Leave plan"-Zweig: Session sofort beendet, angebotene Planübernahme samt Rep-Target-Wizard verworfen.
- `screens-schedule.jsx:2259` Flex-Toggle löscht alle REST-Days ohne Confirm und stellt sie beim Zurückschalten nicht wieder her, obwohl der Screen für jede andere Day-Löschung bestätigt.
- `ui.jsx:1358` Karten-Reorder im 2-Spalten-Grid: der Hit-Test ist rein eindimensional (y), im zweispaltigen Health-Grid fallen die y-Mittelpunkte beider Items einer Zeile zusammen, rechte Spaltenplätze sind per Drag nicht erreichbar.
- `screens-health.jsx:3529` Health-Karten-Reorder schiebt alle gerade unsichtbaren Karten dauerhaft ans Ende der persistierten Reihenfolge.
- `screens-lib.jsx:5629,5661` SpectatorScreen hardcodiert seine Rücksprünge auf Settings, aus der Coach-Client-Ansicht heraus geöffnet landet der Zurück-Pfeil im falschen Screen.

**Weitere Einzelbugs mit sichtbarer Wirkung (low)**

- `screens-lib.jsx:5563,5567` SpectatorScreen: stale Closure auf `loading` macht "Session ended" unerreichbar, und jeder fehlgeschlagene Poll wird als "nicht am Trainieren" gerendert statt als Fehler.
- `screens-lib.jsx:4619` SessionEditSheet markiert geleerte Sätze als `done: true` und zählt sie mit.
- `screens-lib.jsx:5309` SessionCompareScreen matcht Entries nur über die exId und vergleicht doppelt trainierte Übungen gegen die falsche Occurrence.
- `screens-lib.jsx:226` Library "Recent": ohne Session-Dedup füllt eine Session mit derselben Übung zweimal beide Trend-Slots selbst, der Pfeil ist immer neutral.
- `screens-water.jsx:261` `today` ist ein reiner Render-Zeitpunktwert. Bleibt der Water-Screen über Mitternacht offen, landen Einträge auf dem Vortag.
- `screens-health.jsx:4184` Health-Export nimmt die Daily-Log-Zeilen als Datumsachse; Tage mit Session oder Cardio, aber ohne Daily-Log fehlen komplett.
- `screens-health.jsx:3462` Day-Type-Heal-Effect ist kein echter Functional-Update (`nextLogs` aus dem Render-Closure statt `s.dailyLogs`) und verwirft im selben Commit gequeuete `dailyLogs`-Updates des Food-Reconcile-Effects.
- `screens-coaching-detail.jsx:1664` `ClientNutritionTab` ignoriert `{ error }` und behauptet dann "No meal plans yet".
- `ui.jsx:528` Stepper implementiert die `max`-Prop nicht. Fünf Settings-Steppers haben faktisch keine Obergrenze.
- `store.js:372` `importFromBackup` setzt `show_warmup_in_summary` auf `false`, während alle anderen drei Pflichtstellen auf `true` defaulten.
- `store.js:233` `deleteAllData` räumt `zane_recipe_shares` nicht ab: nach dem Komplett-Wipe liefert jeder alte `?share=<token>`-Link den jsonb-Snapshot samt Nutzernamen weiter aus.
- `screens-settings.jsx:1099` Unmount während laufender Push-Verifikation lässt eine gültige Zeile in `zane_push_subscriptions` und die Browser-Subscription zurück.
- `screens-settings.jsx:824` `get_active_sessions_overview` wird alle 2 s gepollt, solange der Settings-Screen gemountet ist, nicht nur bei offenem Sheet.
- `supabase/schema.sql:1598` `zane_coaching_guard_update` ist die einzige der drei Guard-Trigger-Funktionen ohne REVOKE, `authenticated` hat EXECUTE.
- `supabase/schema.sql:2870` `admin_schema_inventory` liefert nur `anon_exec`. Der wöchentliche Live-Drift-Check kann die von CLAUDE.md geforderte `authenticated`-Grant-Prüfung strukturell nicht durchführen, also genau den laut Migration 0208 noch offenen Pfad.
- `tools/check-db-docs.cjs:124` prüft Spalten-Doku mit freiem Substring-Test und ist für kurze Spaltennamen wirkungslos (Treffer irgendwo in der Sektion, auch mitten in einem anderen Spaltennamen oder in deutscher Prosa).

---

## Halbfertig / tote Enden

**Halbfertig (7)**

- `screens-food.jsx:4118`: Meal-Plan-Export schreibt ein eigenes Format (`type: 'zane-meal-plan'`), für das es **keinen Importer** gibt. Der Trainingsplan hat Export **und** Import mit Typ-Validierung, der Meal-Plan nur die Export-Hälfte.
- `screens-lib.jsx:6121` ExerciseHistoryScreen: für Checkbox-Übungen ein KG/REPS-Umschalter, bei dem beide Optionen ein leeres Koordinatensystem mit Achsen 0-10 rendern. `isAssistedEx` ist dort toter Code.
- `screens-coaching-detail.jsx:4` `LineChartSheet` destrukturiert `icon` und `invertColor` und verwendet beides nirgends. Die Props werden über `openChart`/`chartModal` bis ins Sheet durchgereicht und verpuffen.
- `screens-coaching-tabs.jsx:1226` Check-in löschen: der `deleting`-State wird gesetzt, aber nie konsumiert. Kein disabled, kein Busy-Zustand, keine Reentrancy-Guard.
- `screens-settings.jsx:1099` Push-Verifikation ohne Unmount-Cleanup (siehe oben).
- `tools/check-syntax.cjs:27` zwei ausgelieferte Plain-Scripts ohne CI-Abdeckung (M37).
- `supabase/functions/auto-close-sessions/index.ts:61` Fallbacks, die eine Absicherung vortäuschen (M33).

**Toter Code (7)**

- `app.jsx:1550` Router-Case `'coaching-dashboard'` ist von keinem Nutzerpfad erreichbar und hält die abgelöste Roster-Implementierung `CoachingDashboard` + `ClientCard` (`screens-coaching-core.jsx:706-743`) am Leben. Zusammen mit `CoachingSettingsSection` (`core.jsx:562-702`) sind das rund 180 Zeilen unerreichbare Coaching-UI, die über `window.Screens` registriert ist; der Kommentar bei `core.jsx:559-560` behauptet fälschlich einen Aufrufer.
- `app.jsx:333` `localDirty` wird an drei Stellen gesetzt und nirgends gelesen. Der Kommentar liest sich wie ein Dirty-Guard für den Post-Boot-Flush, den es nicht gibt. Zusammen mit H2 verschleiert das genau die Fehlerklasse, die dort real ist. Ebenfalls tot: `window.__createExercise` (`app.jsx:1485`), ein globaler Einstiegspunkt ohne Aufrufer.
- `screens-train.jsx:2024-2032,2078-2084` `removeSet` und `skipSet` sind vollständig ausprogrammiert (inklusive Confirm-Dialog und Auto-Navigation) und an keine UI angebunden.
- `screens-train.jsx:4230` `kbFresh`: toter State neben `kbFreshRef`, zwei Reset-Stellen pflegen beide und suggerieren zwei Wahrheiten.
- `screens-train.jsx:3187` `mesoJointPendingNav`: State, dessen Wert und Setter im ganzen Repo unreferenziert sind. Der Name deutet auf eine nie fertiggestellte Mechanik.
- `screens-train.jsx:200` `getMesoWeightBoosts` wird nirgends aufgerufen, und der Kommentar in Zeile 199 behauptet einen Aufrufpunkt beim Session-Start, den es nicht gibt.
- `screens-home.jsx:152` und `screens-settings.jsx:2541` schreiben `logbook-unit-prompted`, gelesen wird der Key nirgends. Das Unit-Prompt-Gate hängt allein an `store.settings?.unit == null` (`app.jsx:1159`).

**Doku-Drift (8)**

- `CLAUDE.md`: nennt vier CI-Gates, `check.yml` führt fünf aus (`check-cache-version.cjs` fehlt inklusive der Zählung "alle vier").
- `CLAUDE.md`: dokumentiert drei Dark-Modes, es gibt vier. Ausgerechnet `paper` fehlt, obwohl sein Opt-out-Key `logbook-paper-accent-enabled` weiter unten in derselben Datei dokumentiert ist.
- `docs/autoreg-v2-spec.md:3`: "Noch kein Code", obwohl die komplette Engine in `store.js` implementiert und in train/home/lib verdrahtet ist.
- `docs/water-tracker-plan.md:3`: "Nothing implemented yet", obwohl der Tracker samt Migrationen 0180/0183, eigenem Screen und Route ausgeliefert ist.
- `docs/database.md:480`: beschreibt `get_recent_signups` als Quelle des Admin-Feeds, tatsächlich läuft er über `get_all_users_admin`.
- `supabase/schema.sql:1068,1082,1096`: die Function-Bodies von `get_coach_info`, `get_coaching_clients` und `get_coach_clients_status` sind auf dem Stand **vor** Migration 0085, der `id NOT LIKE 'support_%'`-Ausschluss fehlt in allen dreien. Der Snapshot muss laut CLAUDE.md mit dem Live-Schema übereinstimmen.
- `src/feature-map-db.js:152`: der Master-Katalog hat keine Karte für Blutdruck- und Körpertemperatur-Tracking, obwohl beides ausgeliefert ist und der Katalog als Basis-Ebene und Offline-Fallback für `features.html` dient.
- `src/screens-onboarding.jsx:409`: die Customize-Tour beschreibt drei Themes mit einem Drei-Button-Mockup und der Beschriftung "Black". Real sind es vier, der zweite heißt "OLED", Paper fehlt ganz.

---

## Unsicher, braucht einen Blick

Die Verifikation hat jeden der 148 Kandidaten eindeutig entschieden, es gibt **keine formal UNCERTAIN-markierten Befunde**. Die folgenden vier sind technisch bestätigt, aber ihr Fix hängt an einer Produktentscheidung, nicht an einer Codefrage:

1. **M21 Adhärenz-Rescoring** (`screens-health.jsx:3400`): Ist rückwirkendes Neubewerten bei Zieländerung gewollt? Der Code-Kommentar und `store.js` sagen "Save-Time-Snapshot", das Verhalten sagt "immer aktuell". Eins von beiden muss weichen.
2. **M8 Rest-Timer 0** (`store.js` + `screens-settings.jsx`): Soll 0 "Timer aus" bedeuten (dann `??` statt `||` an fünf Stellen) oder ist 0 fachlich ungültig (dann `min={1}` am Stepper)? Aktuell ist beides halb umgesetzt.
3. **M13 Weekday-Versionierung** (`screens-schedule.jsx:2177`): Soll ein Day-Typ-Wechsel bei Weekday-Plänen eine neue Plan-Version erzwingen? Die Cycle-Variante tut es, die Weekday-Variante nicht.
4. **`docs/water-tracker-plan.md` und `docs/autoreg-v2-spec.md`**: Sind das historische Planungsdokumente (dann Status-Zeile "umgesetzt in ..." und archivieren) oder aktive Specs (dann nachziehen)? Aktuell widersprechen sie beide dem ausgelieferten Stand.

---

## Vorgeschlagene Reihenfolge

Billig zuerst, hoher Impact zuerst. Fixes, die dieselbe Datei anfassen, sind zu Batches zusammengefasst.

1. **Batch "Restore-Pfad" (`src/store.js` + `src/screens-settings.jsx`).** C2 (mixed-unit-Multiplikator), C3 (Food-Logs im Export nachladen), M28 (`exportData` try/catch plus Schritt 2 erst nach erfolgreichem Schritt 1), M27 (`handleDeleteAll` try/catch, `markIntentionalSignOut` erst unmittelbar vor `signOut`). Vier zusammengehörige Änderungen an zwei Dateien, die zusammen den einzigen unwiederbringlichen Datenverlust der App beseitigen. Danach ein Round-Trip-Test über `tools/check-backup-coverage.cjs`.
2. **Batch "Sync-Wedge" (`src/store.js` + `src/screens-food.jsx`).** C1 (`ensureFoodCached` awaiten, 23503-Fallback auf `food_id: null`), M10 (FK-Reihenfolge Rezept vor Log), M7 (`mergeSessions`-Datumsschranke nur ohne Base). Ein zusammenhängendes Thema: nach diesen drei kann ein einzelner Fehlschlag nicht mehr den ganzen Sync und damit ungesyncte Workouts mitreißen. M7 braucht einen Test in `tools/test/store.test.cjs`.
3. **Batch "app.jsx-Merge" (eine Datei, vier Fixes).** H1 (uid-Guard plus `loadSeq`), H2 (base-aware Settings-Merge), M1 (base-Guard in `softRefresh`), M2 (`intentionalSignOut` als Timestamp). Alle vier sitzen in `src/app.jsx` zwischen Zeile 330 und 1000 und teilen sich dieselbe Ursache: fehlende Base-/Identitäts-Guards. Beim Anfassen gleich M3 (1298), M4 (1435) und M5 (366) mitnehmen, dann ist die Datei durch. `localDirty` und `window.__createExercise` bei der Gelegenheit entfernen.
4. **H3 Status-Picker** (`src/screens-health.jsx`). Isoliert, klarer Fix, verhindert stillen Verlust einer laufenden Sick/Vacation-Periode. Im selben Aufwasch M22 (sichtbare Fehlermeldung bei fehlgeschlagenen Glukose-/BP-/Temperatur-Writes, sechs Pfade in derselben Datei) und M23-Gegenstück.
5. **H5 Chain-Techniken** (`src/screens-train.jsx`, drei Funktionen, je eine Zeile) plus die Bestandsdaten-Migration. Danach stimmen Volumen und PRs wieder. Im selben Durchgang M16 (`currentSetIdx`) und M17 (Auto-Arm-Guard), beide in derselben Datei, beide Ein-Zeilen-Änderungen.
6. **H4 Day-id-Kollision** (`src/screens-schedule.jsx`). Guard kopieren plus `schedule` durchreichen. Im selben Batch M12 (`withVersionedDays`), M14 (`versionFrom` im Back-Kontext) und M15 (Backup-Liste `{ error }` prüfen), alle vier in derselben Datei.
7. **Batch "Migrationen" (ein PR).** M30 (`collapse_water_logs` REVOKE, Entwurf liegt bereits unter `docs/grok/migs/0213`), M31 (`zane_guard_user_id`-Trigger auf die drei Food-Tabellen), M32 (`zane_coaching_guard_update` um checkin_enabled/checkin_schema/support_* erweitern), plus das REVOKE für `zane_coaching_guard_update` selbst. Dazu `supabase/schema.sql` und `docs/database.md` nachziehen (behebt gleichzeitig zwei der acht Doku-Drifts).
8. **Batch "Edge Functions" (ein Deploy).** M33 (`!res.ok`-Guard in `auto-close-sessions` und `reminder`), M34 (`use_pushover` respektieren in `auto-close-sessions` und `zane_coaching-notify`), M35 (Quota nur für `action === 'search'` zählen, plus Endlos-Retry im Favoriten-Repair abstellen).
9. **Batch "CI/Tooling".** M37 (`plainSources`/`globalScopeSources` erweitern), M36 (`bake-feature-map` bumpt die `?v=`-Buster mit), `tools/check-db-docs.cjs` Substring-Test verschärfen. Billig und verhindert Wiederholungen.
10. **M6 `reloadCoachingState`** (`src/store.js`, zwei fehlende Filter) plus M25 (`CoachingPendingBanner` auf `reloadCoachingState` umstellen). Betrifft real existierende Nutzer mit Coach und offenem Support-Ticket.
11. **Em-Dash-Sweep (M38).** Ein mechanischer Durchgang über `src/whatsnew.js` und die user-visible Strings in app/home/health/onboarding/cardio/lib/schedule/settings. Das Platzhalter-Glyph ausnehmen. Danach am besten ein Grep-Gate in `check.yml`, sonst kommt es zurück.
12. **Rest.** UI-Inkonsistenzen nach Muster abarbeiten (Primitives statt Handbau, dann Einheiten-Labels, dann Theme-Tokens), toten Code entfernen, Doku-Drift nachziehen. Die vier Punkte aus "Unsicher" vorher entscheiden.
