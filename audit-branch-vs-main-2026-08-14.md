# Audit-Bericht: Branch vs main

Branch: `claude/inspiring-euler-nikqcp` (identisch mit `codex/friends-social-preview` zum Zeitpunkt des Reviews)
Basis: `origin/main` (keine gemeinsame Historie mit dem Branch, daher wurde inhaltlich auf den Diff-Umfang des Branches selbst fokussiert)
Geprüft gegen Commit: `9c8b9ea8`
Datum: 2026-08-14
Methode: Workflow `audit-branch-vs-main`, 11 unabhängige Fokus-Reviews (Friends/Social-Followup, DB-Stability Security, DB-Stability Korrektheit, Client-Scheduler/Circuit-Breaker, Grant-Audit, Schema/Doku-Drift, Backup-Coverage, übrige Screens, Precompile-Loader/CI, CI-Gate-Integrität, Edge Functions), danach adversariale Verifikation jedes Fundes (Security-Findings brauchen 2 von 3 zustimmenden unabhängigen Verifizierern, alle anderen 1 von 1, fail-closed). 50 Subagenten, 29 bestätigte Findings, 3 geprüft und verworfen.

Vorherige Reviews zu diesem Branch: `docs/ship-review-friends-social-preview.md` und `docs/ship-review-friends-social-preview-followup.md` (beide nur zum Friends/Social-Pfad, vor der heutigen DB-Stabilitäts-Härtung).

Hinweis zur Verifikationsqualität: bei zwei Findings (`social_broadcast_canary.sql:62` und `store.js:91`) hat der automatische Verifizierer nur Platzhaltertext ("test") statt echter Belege geliefert. Beide wurden deshalb zusätzlich manuell im Code nachgelesen und sind real (siehe Belege in den jeweiligen Abschnitten unten und der direkte Codevergleich `broadcast_social_user()` vs. `broadcast_coaching_user()`).

---

## Urteil

**do-not-ship.** Der Branch bringt zwei grosse, jeweils schon mehrfach geprüfte Feature-Pfade (Friends/Social, DB-Stabilitäts-Härtung nach Incident), trotzdem stehen 29 bestätigte Findings im Diff, davon 16 als Bug und 1 als Security eingestuft. Mehrere Bugs betreffen genau die Kernversprechen der heutigen Härtung selbst (Circuit Breaker, Request-Limit, Timeout, Realtime-Fehlerbehandlung) und den neuen Wartungsmodus (Admin-Aussperrung, App-Crash-Pfad). Die heutige Härtung ist damit isoliert betrachtet nicht fehlerfrei, sie führt neue, teils selbstwidersprechende Bugs ein, während sie alte Probleme behebt. Der Friends-Pfad hat trotz zweier vorheriger Reviews weiterhin einen sicherheitsrelevanten Block-Bug und eine unabhängige, seit längerem bestehende Admin-Bypass-Lücke wird durch denselben Diff sichtbar. Ship erst nach Behebung der Security- und Kern-Bugs, die restlichen Findings können geplant nachgezogen werden.

## Was dieser Branch macht

Der Branch führt zwei inhaltlich unabhängige Arbeitsstränge zusammen:

1. **Friends- und Social-Feature-Pfad**: Freundschaften, Gruppen, Chat-Nachrichten, Plan-Shares, Workout-Kommentare, Blocking/Reporting, Realtime-Broadcast für Social-Events, Runtime-Transport-Umschaltung (broadcast/legacy) sowie ein globaler Social-Wartungsmodus mit eigenem Maintenance-Screen. Bereits zweimal separat geprüft (`docs/ship-review-friends-social-preview.md` und Folgeversion).
2. **DB-Stabilitäts-Härtung vom 14.08.2026**: Reaktion auf einen echten Incident, dokumentiert in `db-stability.md`. Enthält unter anderem RLS-Runtime-Gate für Social-Tabellen im Wartungsfall, Query-Load-Shedding (`get_session_stats`-Signaturänderung, `social_get_badge`, Composite-Index auf `zane_sets`), Exception-sicheres Realtime-Broadcasting für Coaching, einen neuen `db-health`-Edge-Function-Endpoint, sowie clientseitige Scheduler-/Circuit-Breaker-Logik in `src/store.js` (Request-Queue, Priorisierung, Pressure-Erkennung).

Laut Auftrag war die Härtung bereits "live getestet und ausgerollt", trotzdem zeigt der Diff-Review mehrere neue, nicht triviale Defekte in genau diesem Teil.

## Bestätigte Findings, gruppiert nach severity

### security

- **supabase/migrations/0262_x_handles.sql:190** – `get_archived_support_chats()` prüft nur `IF auth.uid() <> v_admin_id`, ohne `IS NULL`-Schutz. Ist `v_admin_id` NULL (Admin-Account fehlt/umbenannt), wird der Vergleich zu SQL-NULL, `IF NULL` verhält sich in plpgsql wie FALSE, die Exception feuert nicht. Jeder eingeloggte User kann dann per RPC alle archivierten Support-Chats inklusive Klartext-E-Mails und Nachrichteninhalten abrufen. Die Schwesterfunktion `get_support_chats()` im selben File hat den korrekten `IS NULL OR`-Schutz. Fix: Zeile 190 auf `IF auth.uid() IS NULL OR auth.uid() <> v_admin_id THEN` angleichen, in neuer Migration nachziehen.

### bug

- **supabase/migrations/0283_fix_social_block_group_membership.sql:39** – In einer Gruppe mit fremdem Owner entfernt `social_block_user()` bei einem Block den Blocker selbst aus der Gruppe statt die geblockte Person. Kehrt den Sinn des Block-Features um. Fix: bei fremdem Owner entweder nur Chat/Feed/Metrics ausblenden statt DELETE, oder die geblockte Person entfernen sofern der Owner das zulässt, und den Confirm-Dialog entsprechend warnen.
- **supabase/migrations/20260814044155_social_broadcast_canary.sql:62** – `app_private.broadcast_social_user()` ruft `realtime.send()` ohne Exception-Handling auf; ein Realtime-Fehler rollt den zugrunde liegenden Chat-/Friend-/Group-Write zurück. Das Coaching-Pendant `broadcast_coaching_user()` wurde in derselben PR genau dagegen gehärtet. Fix: analog in BEGIN/EXCEPTION WHEN OTHERS wrappen.
- **supabase/migrations/20260814044145_db_guardrails.sql:68** – Die RESTRICTIVE-Policy "social runtime gate" gilt auch für `zane_social_reports` und blockiert im Wartungsmodus auch den Admin, da `app_private.social_available()` keine Admin-Ausnahme hat. Genau im Incident-Fall verliert der Admin die Moderationsfähigkeit. Fix: Tabelle aus dem Gate herausnehmen oder Admin-Ausnahme in `social_available()` ergänzen.
- **supabase/migrations/20260814044149_query_load_shedding.sql:130** – `social_get_badge()` ist im Gruppen-Zweig nicht indexbasiert (`social_group_visible` als SECURITY-DEFINER-Call pro Zeile, kein sargable Prädikat), läuft laut `db-stability.md` alle zwei Minuten pro eingeloggtem Nutzer. Reproduziert die Scan-Last, die die Migration eigentlich beheben soll. Fix: Gruppen-Zweig auf `m.group_id IN (SELECT gm.group_id FROM zane_social_group_members gm WHERE gm.user_id = v_uid)` umstellen.
- **supabase/migrations/20260814044149_query_load_shedding.sql:51** – `DROP FUNCTION public.get_session_stats(uuid)` ohne `IF EXISTS`, inkonsistent zum Rest derselben Migrationsserie. Zweiter Lauf bricht ab. Fix: `IF EXISTS` ergänzen.
- **src/store.js:91** – `limitedSupabaseFetch` und der Supabase-Client haben keinen Timeout/AbortController. Ein hängender Request blockiert dauerhaft Queue-Slots; bei `DB_WRITE_LIMIT = 2` reichen zwei hängende Writes, um alle kritischen Saves zu blockieren, ohne dass der Circuit Breaker greift. Fix: Timeout einbauen und Slots im `finally` garantiert freigeben.
- **src/store.js:223** – `isDatabasePressureError` öffnet den Circuit Breaker für jeden Fehler innerhalb von 5 Sekunden nach irgendeinem 429/5xx im Client, unabhängig vom tatsächlichen Fehler, auch bei fachlichen Validierungs-/Berechtigungsfehlern. Verstößt gegen die dokumentierte Abnahmeregel. Fix: Fallback nur greifen lassen, wenn der konkrete Fehler selbst keine erkennbare Ursache hat, plus `status` real befüllen statt auf ein nie gesetztes Feld zu prüfen.
- **src/store.js:334** – `fnFetch` ruft den globalen `fetch` direkt auf, nicht `limitedSupabaseFetch`. Alle Edge-Function-Aufrufe (Food-Search, Label-Scan, AI-Summary usw.) umgehen damit das dokumentierte harte 4-Request-Limit komplett. Fix: `fnFetch` durch `limitedSupabaseFetch` oder `scheduleDbTask` routen.
- **src/store.js:147** – Die Prioritäts-Queue wirkt nur auf explizite `scheduleDbTask`-Aufrufe; die Mehrheit der direkten `_supabase.from/rpc`-Calls landet ungetaggt in derselben flachen FIFO-HTTP-Queue. Ein kritischer Write kann hinter niedriger priorisierten Direktaufrufen warten. Fix: entweder konsequent über `scheduleDbTask` führen oder Priorität in `limitedSupabaseFetch` abbilden.
- **tools/test-coaching-broadcast.cjs:219** – Der Rollback-Test ruft `admin_set_coaching_transport` über `clients.coach` statt einen dedizierten Admin-Client auf; die Funktion prüft serverseitig exakt die Admin-E-Mail. Test schlägt bei normaler Konfiguration mit Unauthorized fehl. Fix: eigenen Admin-Client analog zu `tools/test-realtime-broadcast.cjs` einführen.
- **tools/check-db-live.cjs:103** – `EXPECTED_REALTIME` wurde nicht an die Publication-Änderungen dieses Branches angepasst (vier Coaching-Tabellen entfernt, neun Social-Tabellen hinzugefügt). Der wöchentliche Drift-Check meldet garantiert 13 Fehlalarme und versteckt damit echten zukünftigen Drift. Fix: Set auf die neun Social-Tabellen umstellen, Coaching-Tabellen entfernen.
- **tools/check-backup-coverage.cjs:210** – `parseLoadedSettingsColumns` scannt nur `loadFromSupabase`, nicht `mapUserSettings()`, wo die eigentlichen Settings-Mappings (u.a. `showFriendsTab`, `mealCategories`) liegen. Empirisch verifiziert: Entfernen eines `settingsChanged`-Eintrags lässt das Tool trotzdem grün laufen. Die CI-Absicherung der Vier-Stellen-Regel ist für praktisch alle Settings nur Schein. Fix: Body von `mapUserSettings()` zusätzlich scannen.
- **src/screens-settings.jsx:765** – `closeMealTimes()` persistiert bei jedem Schließen des Sheets, weil `mealCategoryDraft` beim Öffnen immer unconditional befüllt wird und nie leer ist. Für Nutzer mit reinem Legacy-Zustand (`mealCategories === null`) erzeugt bloßes Öffnen+Schließen einen echten, unnötigen Supabase-Write. Fix: nur bei tatsächlicher Abweichung vom Ausgangszustand persistieren.
- **src/screens-settings.jsx:2810** – Direkte Folge des vorigen Bugs: der "Customized"-Hint erscheint fälschlich, sobald der Nutzer das Meal-Times-Sheet einmal geöffnet und geschlossen hat, ohne etwas zu ändern. Fix: Hint erst zeigen, wenn der Draft von den eingebauten Defaults abweicht.
- **index.html:1752** – `FriendsMaintenanceScreen` fehlt in der `lazyScreens`-Map des Precompile-Loaders, obwohl `screens-friends.jsx` sie zusammen mit `FriendsScreen`/`FriendRequestBanner` registriert. `app.jsx` greift im Wartungsfall direkt auf `window.Screens.FriendsMaintenanceScreen` zu; ist das `friends`-Modul (sechstes Idle-Modul) noch nicht geladen und der gecachte `runtimeConfig` bereits `maintenance`, crasht die App genau im Incident-Szenario, das dieser Branch eigentlich abfedern soll. Fix: `FriendsMaintenanceScreen: 'friends'` in die `lazyScreens`-Map aufnehmen.
- **supabase/functions/db-health/index.ts:47** – HEAD-Requests bekommen nur im 200-Erfolgsfall eine body-lose Antwort; alle 401/503-Fehlerpfade senden trotzdem vollen JSON-Body, obwohl HEAD offiziell unterstützt wird. Gerade die 503-Pfade sind für einen Uptime-Monitor der relevante Fall. Fix: HEAD-Behandlung zentralisieren (Helper-Funktion für alle Return-Stellen).

### ux

- **src/ui.jsx:108** – Ein auf einem echten iOS-Gerät bestätigter Fix gegen ein verschwommenes Statusbar-Rendering (`+30px` Padding, `backdropFilter`) wurde durch die gegenteilige, unbelegte Behauptung im Kommentar ersetzt und der Fix entfernt, gleiches Muster in vier weiteren Dateien. Ohne neuen On-Device-Beleg besteht das Risiko, dass der ursprüngliche Bug auf denselben Geräten zurückkehrt. Fix: vor Ship auf dem ursprünglich betroffenen Gerät erneut prüfen oder den alten Fix wiederherstellen.

### unfinished

- **package.json:8** – Neue `wrangler`-Dependency wird nirgends im Diff oder Repo verwendet (kein Script, kein Workflow-Schritt). Bläht jeden CI-Install unnötig auf. Fix: entfernen, falls kein lokaler Wrangler-Workflow beabsichtigt ist.
- **tools/test/store.test.cjs:78** – Die sieben Social-Mapper-Funktionen (`normalizeSocialMetricVisibility`, `mapSocialFriend` usw.), die die Sichtbarkeit von Freundes-Metriken inklusive Legacy-Fallback-Logik steuern, haben keinen einzigen Test. Genau hier würde ein stiller Regressions-Bug zu falsch sichtbaren Metriken führen, ohne dass CI es bemerkt. Fix: Unit-Tests für Normalisierung und Mapper mit camelCase- und snake_case-Rohdaten ergänzen.

### inconsistency

- **docs/database.md:776** – Beschreibt Blocking in Gruppen als reines symmetrisches Ausblenden, tatsächlich löscht `social_block_user()` Mitgliedschaftszeilen asymmetrisch je nach Owner-Konstellation (siehe Bug oben). Fix: Absatz auf den tatsächlichen 0283-Vertrag ziehen.
- **supabase/schema.sql:4598** – Enthält weiterhin einen toten Zwischenstand von `social_get_dashboard` aus Migration 0282 (ohne `require_social_available()`-Guard, ohne per-User-CTE-Optimierung) neben der tatsächlich aktiven Endfassung bei Zeile 5781. Verletzt den geforderten Ein-Definition-je-Funktion-Snapshot-Vertrag. Fix: alten Zwischenstand aus schema.sql entfernen.
- **tools/check-backup-coverage.cjs:71** – Die EXCLUDED-Begründung für `zane_social_profiles` ("reference other users") ist sachlich falsch: die Tabelle ist reine Pro-User-Zeile ohne Fremdverweis auf andere User, offenbar von Nachbar-Einträgen kopiert. Fix: tabellenspezifische, zutreffende Begründung eintragen.
- **src/screens-coaching-core.jsx:479** – `borderRadius: 5` verstößt gegen die strikte 2/4/6/8/999-Skala (Inputs müssen 4 sein), dupliziert an zwei weiteren Stellen in `screens-settings.jsx`. Fix: alle drei Stellen auf `borderRadius: 4` ändern.

### nit

- **supabase/functions/db-health/index.ts:17** – Token-Vergleich `suppliedToken !== expectedToken` ist nicht constant-time, theoretischer Timing-Seitenkanal ohne zusätzlichen Rate-Limit-Schutz. Fix: constant-time-Vergleich verwenden.
- **supabase/migrations/20260814044149_query_load_shedding.sql:4** – Neuer Composite-Index `zane_sets_user_entry_idx(user_id, entry_id)` deckt den alten `idx_zane_sets_user_id(user_id)` als Präfix vollständig ab, der alte Index wird aber nicht entfernt und belastet weiterhin jeden Write auf der am stärksten schreibbelasteten Tabelle. Fix: alten Index droppen.
- **index.html:1752** – `FriendRequestBanner` wird doppelt registriert (einmal non-silent über die Map, dann sofort danach silent überschrieben), tote erste Registrierung, fragil bei künftiger Reihenfolgeänderung. Fix: aus der `lazyScreens`-Map entfernen, nur die explizite silent-Registrierung behalten.
- **tools/test/store.test.cjs:78** – Testname "with rollback" prüft tatsächlich nur zwei unabhängige statische Config-Werte, kein echtes Umschalt-/Resubscribe-Szenario. Fix: Namen präzisieren oder Event-Dispatch-Pfad mittesten.
- **supabase/functions/meal-reminder/index.ts:79** – Neue `food_day_closed`-Abfrage läuft unbedingt vor der Prüfung, ob überhaupt geplante Einträge existieren, unnötiger Roundtrip in der Mehrheit der Fälle, in einem Branch der sonst konsequent auf günstigere Queries zielt. Fix: Reihenfolge tauschen, `closedRes` nur bei vorhandenen Entries abfragen.

## Offene Risiken und nicht abgedeckte Bereiche

- Zwei Findings wurden geprüft und verworfen: die case-insensitive Admin-E-Mail-Prüfung (`lower()`-Variante in mehreren neuen Admin-Funktionen) ist eine Stilabweichung ohne belegbaren Bypass, da Supabase Auth E-Mails normalisiert; das fehlende `REVOKE EXECUTE` bei `handle_new_user()` ist ebenfalls nur Stil-Inkonsistenz, da die Funktion als Trigger-only (`RETURNS trigger`) ohnehin nicht direkt aufrufbar ist. Beide sind reine Hygiene-Punkte, kein Blocker.
- Keine fehlgeschlagenen Reviewer-Slots, die Abdeckung war vollständig.
- Nicht eigenständig verifiziert in diesem Bericht: das tatsächliche Laufzeitverhalten des Wartungsmodus unter Last (nur Code-Analyse, kein Lasttest), die reale Performance-Verbesserung der Query-Load-Shedding-Migration außerhalb des im Finding beschriebenen lokalen Benchmarks, und ob weitere, hier nicht geprüfte Screens denselben Statusbar-Rückbau ohne Beleg übernommen haben.
- Die Fülle an Bugs direkt in der heutigen Härtung (Circuit Breaker, Request-Limit-Bypass, fehlender Timeout, fehlendes Exception-Handling im Social-Broadcast, kaputter Drift-Check) bedeutet, dass die Kernaussage "bereits live getestet und ausgerollt" nicht bedeutet, dass der Code frei von funktionalen Defekten ist. Ein Redeploy ohne Fixes würde denselben oder einen verwandten Incident-Typ wieder ermöglichen (hängende Requests, ungetaggte Anfragen).

## Empfohlene Reihenfolge vor einem Ship

1. Security-Fix zuerst: `get_archived_support_chats()` NULL-Schutz (0262_x_handles.sql:190), da aktiv aufrufbar und mit vollem Datenleck.
2. Kern-Stabilität der heutigen Härtung reparieren, da sie das eigentliche Ziel des Branches betrifft: Timeout in `limitedSupabaseFetch` (store.js:91), `fnFetch`-Bypass schließen (store.js:334), Circuit-Breaker-Fehlklassifikation entschärfen (store.js:223), `broadcast_social_user()` Exception-Schutz nachziehen (20260814044155:62).
3. Wartungsmodus-Blocker beheben, bevor er in einem echten Incident genutzt wird: Admin-Report-Zugriff (20260814044145:68) und `FriendsMaintenanceScreen`-Crash (index.html:1752).
4. Friends-Block-Bug fixen und Doku korrigieren (0283:39, docs/database.md:776), da sicherheitsnah und nutzerseitig sichtbar falsch.
5. CI-Gates reparieren, damit zukünftige Regressionen wieder auffallen: `check-backup-coverage.cjs` SYNC-Scan (Zeile 210) und `check-db-live.cjs` EXPECTED_REALTIME (Zeile 103), sonst bleiben beide Checks blind bzw. lärmen falsch.
6. Restliche Bug-/Performance-Findings (social_get_badge Index, DROP FUNCTION IF EXISTS, redundanter Index, Meal-Times-Persist-Bug, db-health HEAD-Bodies) in einem Folge-PR bündeln.
7. Inconsistency- und Nit-Findings (schema.sql-Zwischenstand, borderRadius, Backup-Begründung, doppelte Lazy-Registrierung, Testnamen, wrangler-Dependency, Mapper-Tests) planbar nachziehen, blockieren den Ship nicht zwingend, sollten aber nicht liegen bleiben.
8. iOS-Statusbar-Rückbau (ui.jsx:108) vor Rollout an ein breiteres iOS-Publikum auf dem ursprünglich betroffenen Gerät verifizieren.
