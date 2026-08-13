# Ship-Review Follow-up

Branch: `codex/friends-social-preview`  
Basis des ersten Reviews: `docs/ship-review-friends-social-preview.md`  
Geprüft gegen: Commit `2bf08903` (`audit round`) plus aktueller Working Tree  
Datum: 2026-08-13

## Urteil

Die 24 bestätigten Findings aus dem ersten Review sind im Code **bis auf eines** geschlossen. Die Security- und Gate-Blocker sitzen in Client plus Migration `0279_social_audit_hardening.sql`.

Ship-Bedingung, die nicht im Diff liegt: **0279 muss auf der Live-DB ausgeführt werden.** Ohne diesen Schritt gelten Blocks, `created_at`-Trigger, serverseitige Woche und die neuen Policies dort nicht.

## Was der erste Review als behoben werten kann

Nicht noch einmal im Detail. Kurz zur Einordnung:

- Security: clientgesteuerte Woche, `created_at`-Bypass, Block in Gruppen, Attachment-Pfad, Workout-Detail vs. Toggle/Doku
- Bugs: Train-Poll-Gate, Chat-Attachments, In-Flight-Reload, Realtime-Reads, Plan-Import-Felder, Food-Day-Closed-Fill, `XHandlePrompt`-Lazy-Load
- UX: Banner-Gate, Later/Train-Guard, Badge-Summe, leere Suche, Toggle-Navigation, Workout-Share-Copy
- Rest: Feature-Map v46, Today-Score-Freeze, Cheer-Toast-Tokens

## Noch offen

### 1. Migration 0279 ist nicht automatisch live

Datei: `supabase/migrations/0279_social_audit_hardening.sql`

Ohne Apply auf der echten DB bleiben die alten RPC-Bodies und Policies aktiv. Der Client schickt weiter `p_week_start` / `p_today`, der Server ignoriert sie erst nach 0279.

### 2. Eigenes Handle im Circle (teilweise, einziges offenes Audit-Finding)

Datei: `src/screens-friends.jsx` (Circle-Hero) und `social_lookup_profile`

Erledigt: Friend-Code steht im Circle mit Copy.

Offen:

- Das eigene Social-Handle (`@…`) wird im Circle weiter nicht gezeigt, nur in Settings.
- `social_lookup_profile` sucht nur `zane_social_profiles.handle` und `friend_code`, nicht `zane_profiles.x_handle`. Der X-Handle-Prompt und der Account-Text versprechen den X-Handle weiter für Social, die Suche findet ihn nicht.

Fix, falls noch gewollt: Handle neben dem Friend-Code im Circle-Hero. Entweder Lookup um `x_handle` erweitern und das klar beschriften, oder die X-Copy auf „öffentliches X, nicht Friends-Suche" zurücknehmen.

### 3. Doku: Grant-Vertrag für `social_workout_access`

Datei: `docs/database.md` (Abschnitt Social RPCs)

Der Absatz listet `social_workout_access` und `social_can_view_workout_session` weiter als authenticated-only. 0279 macht `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` auf `social_workout_access`. Es ist ein interner Helper, analog zu `social_health_metric_value` (der dort schon richtig steht).

Fix: `social_workout_access` aus der authenticated-Liste nehmen und als internen Helper ohne Client-EXECUTE führen.

### 4. `schema.sql` enthält tote Zwischenstände

Datei: `supabase/schema.sql`

Es liegen mehrere `CREATE OR REPLACE` für `social_get_dashboard` und `social_health_metric_value` hintereinander. Die letzte Fassung ist 0279 und gewinnt bei einem sequentiellen Replay. Ein Rebuild setzt Live also nicht auf den Leak vor 0276 zurück.

Trotzdem verletzt das den Snapshot-Vertrag (eine aktuelle Definition je Funktion). Die älteren Kopien sind Müll und machen Diffs/Reviews unleserlich.

Fix: Nur die 0279-Fassade behalten, die älteren Bodies löschen.

## Bewusst nicht geschlossen (kein Finding, Residualrisiko)

Diese Punkte waren im ersten Review unter „nicht abgedeckt", nicht als bestätigte Bugs. Sie sind weiter wahr:

- Social liegt nicht im persönlichen Backup. Restore nach Account-Wechsel oder Device-Reset ist dafür nicht abgesichert.
- `tools/test/store.test.cjs` hat keine Social-Fälle (In-Flight-Cache, Mapper, Plan-Import, Gate).
- Grant-Fallen: nicht jede neue Social-RPC-Signatur wurde gegen `has_function_privilege('anon', …)` geprüft. Vor Deploy die Liste einmal durchlaufen.
- Edge Functions und Reminder-Cron wurden nicht neu gegen Social geprüft. `meal-reminder` hängt am geschlossenen Food-Tag; der Client-Fill respektiert das jetzt.

## Empfohlene Reihenfolge

1. `0279_social_audit_hardening.sql` live ausführen.
2. Optional: Circle-Handle plus Lookup/`x_handle`-Copy (Finding 2).
3. Optional: Docs-Grant und `schema.sql`-Duplikate (3 und 4). Reine Hygiene, kein Verhaltensfix.
