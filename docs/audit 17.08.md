# Fresh Full Review

Wiederhergestellt nach Session-Abbruch. Scan und 41 von 42 Verifies waren fertig, der Report-Agent ist nicht mehr gelaufen. Dieses Dokument setzt genau dort an: nur adversarisch bestätigte Funde, plus Residual.

## Lage

14 von 14 Domain-Scans sind durchgekommen. 98 einzigartige Rohfunde, 42 davon zur Prüfung (Round-Robin, damit Theme und Lesbarkeit nicht unter Store-Bugs begraben werden). 41 Verifies fertig, einer abgebrochen. 34 bestätigt, 7 verworfen, 1 ungeprüft.

Keine Criticals nach der Prüfung. 14 High, 17 Medium, 3 Low.

Kein Blick in alte Audit-Dokumente. Alles aus dem aktuellen Tree.

## Critical

Keine.

## High

### [bug] Expired session stays in-app with dead retry

- **File:** `src/app.jsx`
- **Domain:** app-shell
- **Issue:** Ungewolltes `SIGNED_OUT` setzt `authStatus` auf `reauth-required`, bleibt aber in `phase ready`. `flushSync` und `probeSyncConnection` laufen nur bei `online`. Der Recover-Effekt startet nur bei `recovering`. `onRetrySync` ist damit ein stiller No-Op. Es gibt keine Re-Login-UI.
- **Was der Nutzer sieht:** Das Hantel-Icon wird rot. Retry tut nichts. Neue Sätze und Logs bleiben nur lokal, bis die App neu geladen wird.
- **Warum es zählt:** `userIdRef` wird vorher auf null gesetzt, deshalb scheitert `flushSync` zusätzlich und `scheduleLocalSave` schreibt neue Edits nicht mehr. Online-Event kann auf `recovering` umschalten, bei weggeworfener Session schlägt `recoverAuthSession` dann endlos fehl.
- **Vorschlag:** Bei `reauth-required` ein sichtbares Sign-in-Sheet zeigen, Retry auf `recoverAuthSession` legen, und wenn die Session weg ist auf Login umschalten.

### [theme] Time-set overlay uses theme ink on a fixed dark scrim

- **File:** `src/screens-train.jsx`
- **Domain:** theme-readability
- **Issue:** Der Countdown für zeitbasierte Sätze liegt immer auf `rgba(8,6,3,0.92)`. Übungsname, "Go go go" und Stop nutzen theme-reaktives Ink bzw. `--accent`. In Light/Paper wird das dunkelbraun bzw. Paper-Grau auf fast schwarzem Overlay.
- **Was der Nutzer sieht:** In Light oder Paper sind Name, Anfeuerung und Stop bei Plank/Hold kaum oder nicht lesbar.
- **Warum es zählt:** Die Zahl nutzt bewusst `--accent-raw` gegen genau diesen Scrim. Der Rest der Chrome nicht. Stop als Abbruch ist damit unsichtbar.
- **Vorschlag:** Auf diesem Scrim feste helle Farben bzw. `--accent-raw`, analog zur Countdown-Zahl.

### [data] Water mirror splits after delete or override

- **File:** `src/screens-health.jsx`
- **Domain:** health-cardio-water
- **Issue:** Tag löschen entfernt nur `dailyLogs`. Der Dialog behauptet, Wasser sei weg, `waterLogs` bleiben. WaterCard 1D summiert `waterLogs`, Today und 1W lesen `dailyLogs.waterMl`. Unlock-Override schreibt nur `waterMl`.
- **Was der Nutzer sieht:** Nach "Tag löschen" oder manuellem Override zeigt Health eine andere Menge als die Water-Karte und der Tracker.
- **Vorschlag:** Beim Löschen die `waterLogs` des Datums mit entfernen. Override entweder die Einträge anpassen oder 1D dieselbe Quelle nutzen.

### [data] Planned split/merge wipes Health macros

- **File:** `src/screens-food.jsx`
- **Domain:** food
- **Issue:** `applySplit`, `applyBlockRecipe` und `restoreSplitBatch` rufen immer `patchDaily` auf. `patchDaily` setzt Makros auf null, sobald der Tag keine geloggten Einträge hat. `commitEntries` und `deleteEntry` schützen genau diesen Fall, Split/Combine nicht. Undo schreibt die Nullen erneut.
- **Was der Nutzer sieht:** Wer in Plan Mode nur geplante Mahlzeiten splittet oder zusammenfasst, verliert per Hand im Health-Tab gesetzte Makros ohne Warnung.
- **Vorschlag:** Wie bei `commitEntries` nur `patchDaily`, wenn sich die geloggte Menge ändert.

### [bug] Deleted scheduled dose returns as preview

- **File:** `src/screens-medications.jsx`
- **Domain:** medications
- **Issue:** Eine gelöschte, slot-gebundene Dosis bleibt als Tombstone (`skipped`) erhalten. Die Timeline baut `existingSlotIds` nur aus `curDateLogs`, und die filtern `skipped` weg. Dieselbe Dosis hängt sofort wieder als read-only Preview und zählt im Hero als due.
- **Was der Nutzer sieht:** Nach Entfernen erscheint die Dosis sofort wieder als blasse Scheduled-Zeile, der Ring sagt weiter due.
- **Vorschlag:** `existingSlotIds` aus allen Logs des Tages bilden, inkl. skipped, genau wie `mdAutoFillToday`.

### [bug] Deleting a medication leaves today's due rows

- **File:** `src/screens-medications.jsx`
- **Domain:** medications
- **Issue:** `deletePlan`, `deleteSlot` und `removeMedicationFromPlan` rufen `mdReconcilePlannedLogs`. `deleteMedication` nicht. Heutige planned-Logs bleiben. Server setzt `schedule_slot_id` auf NULL, `planned` bleibt true. Der Cron filtert nur `planned=eq.true`.
- **Was der Nutzer sieht:** Nach Löschen eines Medikaments bleiben die heutigen Dosen in der Timeline, der Ring zählt, die Erinnerung kommt trotzdem.
- **Vorschlag:** Vor dem Löschen Slot-Ids sammeln und `mdReconcilePlannedLogs` aufrufen, analog zu `deletePlan`.

### [data] Check-in pause never reaches store

- **File:** `src/screens-coaching-client.jsx`
- **Domain:** coaching
- **Issue:** Nach erfolgreichem `setCheckinEnabled` bleibt `store.coaching.asCoach[].checkinEnabled` unverändert. Toggle, Client-Liste und Tab-Badge rechnen weiter mit dem alten Store-Wert.
- **Was der Nutzer sieht:** Der Coach pausiert Check-ins, geht zurück, der Schalter ist wieder an, CHECK-IN DUE bleibt, der Client ist aber gesperrt.
- **Vorschlag:** Nach erfolgreichem Write `asCoach` im Store mitführen. Bei Fehler zurückrollen.

### [bug] Invite and end wipe badge fields

- **File:** `src/screens-coaching-tabs.jsx`
- **Domain:** coaching
- **Issue:** `reloadCoachingState` liefert kein `anyClientLive` und kein `pendingCheckinsCount`. Invite und End ersetzen trotzdem das ganze `coaching`-Objekt. Der 60-Sekunden-Poll stellt die Felder oft nicht wieder her, weil er bei gleichen Werten den Store unverändert lässt.
- **Was der Nutzer sieht:** Nach Einladen oder Beenden verschwinden Live-Punkt und Check-in-Zahl am Coaching-Tab.
- **Vorschlag:** Wie im Pending-Banner mergen, oder den Status-Poll sofort anstoßen.

### [data] Unread badge can never clear old mail

- **File:** `src/store.js`
- **Domain:** friends-social
- **Issue:** Der Tab-Badge kommt von `social_get_badge` (alle ungelesenen). Inbox und Mark-as-read sehen nur die letzten 300 Zeilen. Ältere Ungelesene bleiben serverseitig ungelesen.
- **Was der Nutzer sieht:** Die Social-Kachel zeigt weiter 3 oder 9+, obwohl jeder offene Chat gelesen wirkt. Nach Home springt die Zahl wieder hoch.
- **Voraussetzung:** Volumen über dem 300er-Fenster.
- **Vorschlag:** Badge nur aus dem geladenen Fenster, oder ältere Ungelesene per RPC als gelesen markieren bzw. paginieren.

### [bug] Social notify 200 drops retries

- **File:** `supabase/functions/zane_social-notify/index.ts`
- **Domain:** backend-edge
- **Issue:** Fehlgeschlagener Provider-Handoff bleibt `delivered_at` null und intern `retryable`, die Function antwortet aber immer HTTP 200. Der Client-Outbox-Flush wertet jedes `ok` als Erfolg und entfernt den Eintrag. Es gibt keinen Cron.
- **Was der Nutzer sieht:** Freundschaftsanfrage, Chat oder Workout-Kommentar kommt als Push nie an, obwohl der Absender schon abgeschickt hat.
- **Vorschlag:** Bei `retryable > 0` 5xx oder 409 zurückgeben, oder den Client den Body prüfen lassen.

### [bug] Spectator back ignores route

- **File:** `src/screens-lib.jsx`
- **Domain:** consistency-sweep
- **Issue:** Der Live-Header ruft hart `go({ name: 'settings' })`. Leerzustand, Ended und Got it nutzen `back || settings`. Der Coach öffnet den Spectator mit `back` auf `coaching-client`.
- **Was der Nutzer sieht:** Session aus dem Coach-Client anschauen, Zurück tippen, in Settings landen.
- **Vorschlag:** Live-Chevron und Comparison-TopBar auf dieselbe `back`-Route legen.

### [ux] Cycle and week start dates bypass draft

- **File:** `src/screens-schedule.jsx`
- **Domain:** schedule
- **Issue:** Cycle start und Week plan start schreiben direkt in den Store. `dirty` sieht das nicht, Save bleibt inaktiv, Discard dreht das Datum nicht zurück. Der Flex-Toggle vermeidet genau dieses Muster.
- **Was der Nutzer sieht:** "Heute = Tag N" springt sofort. Danach Discard: trotzdem das neue Startdatum.
- **Vorschlag:** Daten im draft halten und erst in `doSave` schreiben.

### [ux] Imperial water UI still prints ml

- **File:** `src/screens-water.jsx`
- **Domain:** health-cardio-water
- **Issue:** Hero, Goal und Quick-Adds laufen über `UI.waterToEntry` (fl oz bei `unit=lbs`). Einträge, Flasche, Drink-Kacheln, Milch und Bottle-Size bleiben hart in ml.
- **Was der Nutzer sieht:** Oben Unzen, in der Liste `+500 ml` und eine Flasche in Millilitern.
- **Vorschlag:** Alle Anzeigen über `wtAmt`/`wtUnit` ziehen.

### [bug] Move to paused plan keeps firing today

- **File:** `src/screens-medications.jsx`
- **Domain:** medications
- **Issue:** Beim Verschieben bleiben Slot-Ids gleich, nur `medicationPlanId` wechselt. Pause reconciled heutige planned-Zeilen, `moveMedicationToPlan` nicht. Cron sendet auf `planned=eq.true` ohne Plan-active-Join.
- **Was der Nutzer sieht:** Medikament in einen pausierten Plan schieben, heutige Dosen bleiben due, Erinnerung kommt weiter.
- **Vorschlag:** Nach dem Move reconcilen, wenn der Zielplan nicht active ist.

## Medium

### [data] Stats-RPC-Fehler macht Fenster-Sessions leer

- **File:** `src/store.js`
- **Domain:** store-sync
- **Von High auf Medium gestuft.** Fehler von `get_session_stats` und `get_exercise_best_e1rm` werden nie geworfen. Fenster-Sessions kommen ohne `aggVolume`/`aggDoneSets`, `totalVolume` fällt auf 0. Der Claim "alte Workouts werden gelöscht" ist widerlegt: Orphan-Delete überspringt `ended !== null`.
- **Was der Nutzer sieht:** Workouts älter als 70 Tage zeigen 0 kg und 0 Sätze.
- **Vorschlag:** Stats- und Bests-Fehler wie die anderen Core-Queries werfen.

### [bug] Cache-Boot verwirft Glucose/Blutdruck/Temperatur

- **File:** `src/app.jsx`
- **Domain:** store-sync
- **Von High auf Medium gestuft.** Cached-Boot überschreibt die drei Listen aus `fresh` ohne ID-Merge. Staged-Boot und `softRefresh` mergen sie. Race nach dem Öffnen: neues Reading verschwindet, lokale Löschung kommt zurück. Die Zeile liegt meist in der DB und kommt beim nächsten Refresh wieder.
- **Vorschlag:** Dieselben `localOnly` plus `mergeWindowedCollectionById`-Guards wie im Staged-Boot.

### [theme] Own-message Cancel is black-on-dark accent

- **File:** `src/screens-coaching-core.jsx`
- **Domains:** theme-readability und coaching (zweimal unabhängig bestätigt)
- **Von High auf Medium gestuft.** Eigene Bubbles sind `var(--accent)`. Cancel ist fest `rgba(0,0,0,0.65)`. Light/Paper verdunkeln Accent und setzen `--accent-ink` auf `#f5f5f5`. Nachrichtentext nutzt `accent-ink`, Cancel nicht. Nur im Edit-Modus, Save bleibt lesbar.
- **Was der Nutzer sieht:** In Light oder Paper ist Abbrechen auf der eigenen Blase kaum zu finden.
- **Vorschlag:** Cancel auf `var(--accent-ink)` umstellen.

### [data] Mark as done skips time sets

- **File:** `src/screens-train.jsx`
- **Domain:** train
- **Von High auf Medium gestuft.** `sealDoneSets` erkennt Wert nur an kg/reps. Time-Sätze tragen Dauer in `timeSec`. Mark as done siegelt sie nie, Rest landet als skipped. Volumen ändert sich kaum (Time zählt 0), Historie und `doneSetCount` verlieren die Arbeit. Checkbox ohne Zahl ist bewusst skipped.
- **Vorschlag:** `hasValue` um `timeSec` erweitern, Checkbox bei `sealMode done` als done werten.

### [data] Export/import can persist unschedulable weekday plans

- **File:** `src/screens-schedule.jsx`
- **Domain:** schedule
- Export kann eine ältere Cycle-Version mit `mode weekday` speichern. Import heilt nicht (`pushToClient` schon). Nach Online-Reload heilt `loadFromSupabase` nachträglich.
- **Was der Nutzer sieht:** Nach Import hat der Plan Tage, Home zeigt trotzdem Ruhe.
- **Vorschlag:** `healScheduleWeekdays` auf Import, `doSave` und `doSaveVersion`.

### [data] Daily-log save drops AI summary

- **File:** `src/screens-health.jsx`
- **Domain:** health-cardio-water
- **Von High auf Medium gestuft.** `DailyLogScreen.save()` baut die Zeile ohne Spread und lässt `aiSummary` weg. Server behält den Text, lokal verschwindet die Karte bis zum nächsten Boot. Regenerieren scheitert am Once-per-day-Gate.
- **Vorschlag:** `existing.aiSummary` und `aiSummaryGeneratedAt` durchreichen, analog zu `mealOfChoice`.

### [ux] Done-for-today is not a lock

- **File:** `src/screens-food.jsx`
- **Domain:** food
- **Von High auf Medium gestuft.** Für heute ist Reopen bewusst. Der echte Fehler sitzt auf einem vergangenen geschlossenen Tag: `foodDayClosed` und eingefrorenes `adherence` bleiben, `patchDaily` schreibt Makros neu, der Hero zeigt alten Ring neben neuen Totals.
- **Vorschlag:** Vergangene geschlossene Tage sperren, oder nach Edit `adherence` neu einfrieren. Adds hinter eine Reopen-Bestätigung legen.

### [ux] Chat images die after five minutes

- **File:** `src/store.js`
- **Domain:** friends-social
- Signed URL lebt 300 Sekunden, der offene Chat erneuert nicht. Im offen gelassenen Thread bleibt ein schon dekodiertes Bild typischerweise sichtbar. Kaputt wird es beim Remount oder Cache-Miss.
- **Vorschlag:** Länger gültige URLs, oder vor Ablauf neu signieren, plus `onError`-Retry.

### [ux] Last tour card body is never shown

- **File:** `src/screens-onboarding.jsx`
- **Domain:** settings-onboarding-public
- Der letzte Tour-Schritt wird komplett durch die Trophy-Celebration ersetzt. Der Schlusstext (Plan anlegen, How to wiederfinden) erscheint nie.
- **Vorschlag:** Letzten Karten-Body in der Celebration zeigen.

### [theme] Tour complete subtitle fails on light canvases

- **File:** `src/screens-onboarding.jsx`
- **Domain:** settings-onboarding-public
- Untertitel ist fest `rgba(10,8,5,0.78)`, Titel nutzt `--accent-ink`. Auf Light/Paper verschwindet der Satz auf dem dunklen Verlauf. Screen schließt nach 3s.
- **Vorschlag:** Untertitel ebenfalls auf `--accent-ink`.

### [bug] Web-push 503 on mixed devices

- **File:** `supabase/functions/web-push/index.ts`
- **Domain:** backend-edge
- Immediate-Pfad antwortet 200 nur bei `sent > 0 && failed === 0`. Ein totes plus ein lebendes Abo (1/1) gilt als Fehlschlag, obwohl ein Gerät die Nachricht hat. Nächster Cron feuert erneut.
- **Was der Nutzer sieht:** Wer Handy und Laptop gekoppelt hat, bekommt Nudges mehrfach, sobald ein altes Abo 404/410 liefert.
- **Vorschlag:** 200 sobald `sent > 0`. Tests für `sent=1/failed=1`.

### [ux] Sibling tab back destinations

- **File:** `src/screens-food.jsx` (plus Water, Meds)
- **Domain:** consistency-sweep
- Food, Water und Medications teilen denselben Health-Tabslot. Food-Zurück geht nach Health, Water und Meds immer nach Home.
- **Was der Nutzer sieht:** Zurück auf Food bleibt im Health-Slot. Zurück auf Water oder Meds wirft in den Train-Tab.
- **Vorschlag:** Eine Regel für alle drei.

### [data] Meso history reset commits before Save

- **File:** `src/screens-schedule.jsx`
- **Domain:** schedule
- Reset schreibt `completions` sofort über `setStore`. Discard stellt die Meso-Historie nicht wieder her. Flex-Anker und Meso-Clear warten bewusst auf `doSave`.
- **Was der Nutzer sieht:** Reset, dann Verwerfen der Plan-Edits: abgeschlossene Meso-Blöcke sind trotzdem weg.
- **Vorschlag:** Reset nur im draft merken und erst in `doSave` schreiben.

### [ux] Whole-day import drops the 5/3/1 warning

- **File:** `src/screens-schedule.jsx`
- **Domain:** schedule
- `confirm531LiftImport` greift in DayEditor und Wizard. Cycle-Add-Day und Weekday-Ganztagsimport nicht. Main Lifts werden still zu Smart-Progression.
- **Vorschlag:** Dieselbe Gate vor `onImport` und vor dem Weekday-Platzieren.

### [ux] Feature map still promises live spotlight tours

- **File:** `src/feature-map-db.js`
- **Domain:** settings-onboarding-public
- Katalog behauptet Live-Spotlights und Screen-Navigation. Der Renderer ist ein statisches Kartendeck. `route`/`target`/`placement` sind No-ops.
- **Vorschlag:** Summary und Actions auf Kartendeck mit Mockups umschreiben.

### [ux] Home arrows skip windowed days

- **File:** `src/screens-home.jsx`
- **Domain:** home-lib
- Pfeile auf der Workout-Complete-Karte laufen nur über `doneSession.entries`. Sessions älter als 70 Tage haben `entries: []`. Hydration queued nur Prior-Sessions, nie `doneSession` selbst.
- **Was der Nutzer sieht:** Alten Trainingstag antippen: Workout complete ohne Hoch- oder Runter-Pfeile.
- **Vorschlag:** `doneSession` analog zu SessionDetail hydrieren.

## Low

### [data] Muscle-set stats ignore windowed cycles

- **File:** `src/screens-lib.jsx`
- **Von High auf Low gestuft.** `Sets per Muscle` zählt nur lokale `entries`. StatsTab hydriert danach. Leerzustand hängt an `setsPerMuscle.length === 0`, nicht an vorhandenen Session-Metadaten. Copy-/Lade-Glitch, kein dauerhaftes Datenloch.
- **Vorschlag:** Leerzustand an `thisPeriodSessions.length` koppeln, offline einen Hinweis zeigen.

### [theme] Later-set chart lines lack contrast

- **File:** `src/screens-lib.jsx`
- Set 4 und 5 nur 0.22 bzw. 0.14 Accent-Alpha. Auf Paper und Dark kaum lesbar. Satz 1 bleibt klar, die Satzliste darunter trägt die Daten.
- **Vorschlag:** Mindest-Alpha anheben oder Dash statt immer dünnerer Transparenz.

### [theme] Coach role chip ignores the light-safe tint

- **File:** `src/screens-featuremap.jsx`
- `fmCoachTint()` existiert, weil `#4aab97` auf Light/Paper fällt. Die Admin-Rollenwahl nimmt die Rohfarbe. Nur Admin sieht den Editor.
- **Vorschlag:** Picker über `fmCoachTint()` färben.

## Theme- und Lesbarkeits-Cluster

Das dunkle Default-Theme hält meist. Light und Paper reißen an denselben Stellen:

1. Fester dunkler Scrim plus theme-Ink: Time-Set-Overlay (High).
2. Festes Schwarz auf `var(--accent)`: Chat-Cancel, Tour-Untertitel (Medium).
3. Alpha-Rampen und Dark-first-Tints: History-Chart, Feature-Map-Coach-Chip (Low).
4. Unit-Mix: Water-UI druckt ml neben fl oz (High).

Mehrere unverifizierte Mediums im Residual zeigen dasselbe Muster (Glucose/BP-Blau, Water-Blau, Incoming-Chat auf Light, Category-Cards mit Black-Wash).

## Fix-Reihenfolge

1. `app.jsx`: Session-Expiry mit sichtbarem Re-Login und funktionierendem Retry.
2. `screens-medications.jsx`: Preview nach Delete, Delete-Medikament reconcilen, Move in pausierten Plan reconcilen.
3. `screens-food.jsx` + `screens-health.jsx`: Split/Merge darf Health-Makros nicht nullen; Wasser-Spiegel beim Löschen/Override halten.
4. `zane_social-notify` plus Client-Outbox: kein 200 bei `retryable`.
5. `web-push`: 200 sobald `sent > 0`, sonst Doppel-Nudges.
6. Coaching: Check-in-Pause in den Store, Invite/End Badge-Felder mergen.
7. Time-Set-Overlay und Chat-Cancel auf Light/Paper lesbar machen.
8. Plan-Editor: Cycle/Week-Start und Meso-Reset erst bei Save.
9. `store.js`: Stats-RPC-Fehler werfen; Social-Badge vs. 300er-Fenster.
10. Spectator-Zurück, Water-Einheiten, Tour-Abschluss-Copy.
11. Time-Sätze bei Mark as done siegeln.
12. Home-Pfeile für gefensterte Sessions hydrieren.

## Residual

### Verworfen (7)

Bewusst oder nicht haltbar nach Gegenprüfung:

- Push-Click ohne `navigate`: kein bestätigter Nutzerbug.
- Meso graded ungesiegelte Rest-Sätze: dokumentierte Live-Quelle.
- Same-plan Weekday-Import verschiebt den Quelltag: dokumentierter Relocate-Pfad.
- Edit einer gefensterten Session: früher Save kann lokal `entries:[]` zeigen, persistente Sätze bleiben.
- Goal-Plan überspringt ungenutzte Sessions: due-date-Verankerung, kein Bug.
- Yesterday-Meals nach Mitternacht: kein zusätzlicher Nag nach gelungenem Handoff.
- Recap-Sheet startet leer: bewusste Accordion-Köpfe.

### Ungeprüft (1)

`verify:41:app-shell` ist beim Session-Ende abgebrochen: **Five-tab dock labels overflow**. Nicht bestätigt, nicht verworfen.

### Cap (56 Rohfunde nicht geprüft)

Keine weiteren Highs außerhalb der Verify-Liste. 54 Mediums und 2 Lows blieben liegen. Die interessantesten unverifizierten Mediums, nicht als bestätigt lesen:

- Restore löscht Pillbox- und Template-Day-Zeilen ohne Import (`store.js`)
- Fehlende PR-Baseline nach Besten-RPC-Fehler (`store.js`)
- Update-Wipe droppt Logo, Fonts, Icons (`sw.js` / App-Shell)
- Glucose/BP-Blau und Water-Blau nur auf Dark getunt
- `Add set` droppt Time-Dauer
- Closed Food-Day schluckt neue Plan-Slots
- Show-tab ist der Meds-Master-Switch
- Client-Template aktivieren dosiert den Coach
- Paused Check-in nagt den Client weiter
- Invite enumeriert registrierte E-Mails
- Friends-Tab ist kein Social-Off-Switch
- Block lässt Group-Chats stehen
- Incoming Chat-Bubbles verschwinden auf Light
- Reminder-TTL erreicht Web-Push nie
- Settings-Fetch-Fehler überspringt Rest-Timer

## Abdeckung

| Domain | Scan | Bestätigt |
|---|---|---|
| store-sync | ja | 2 |
| app-shell | ja | 1 (+ 1 ungeprüft) |
| theme-readability | ja | 3 |
| train | ja | 1 |
| schedule | ja | 4 |
| home-lib | ja | 3 |
| health-cardio-water | ja | 3 |
| food | ja | 2 |
| medications | ja | 3 |
| coaching | ja | 3 |
| friends-social | ja | 2 |
| settings-onboarding-public | ja | 3 |
| backend-edge | ja | 2 |
| consistency-sweep | ja | 2 |

Scan-Fehler: 0. Duplikate beim Einsammeln: 0. Cancel-Finding kam aus zwei Domains und ist oben einmal geführt.
