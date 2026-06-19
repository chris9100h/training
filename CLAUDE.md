# Logbook — Projektkontext für Claude

## Sprache

- **Konversation mit dem Nutzer:** Deutsch
- **App-UI, Code, Commits, Kommentare:** Englisch

## Architektur

- **Kein Build-Step.** Keine npm-Pakete verwenden. Abhängigkeiten laufen über CDN-Scripts in `index.html` (React 18, Babel Standalone, Supabase JS).
- **Kein import/export.** Alles läuft über den globalen `window`-Namespace:
  - `window.LB` — Store-Funktionen (aus `store.js`)
  - `window.Screens` — Screen-Komponenten (aus den `screens-*.jsx` Dateien)
  - `window.UI` — UI-Primitives und Farb-Tokens (aus `ui.jsx`)
  - `window.ACCENT_PALETTE`, `window.applyAccentColor` — Akzentfarben-System (aus `index.html`)
- **Babel Standalone** — JSX funktioniert, TypeScript nicht. Syntaxfehler crashen die gesamte App ohne hilfreiche Fehlermeldung.
- **Boot über Precompile-Cache (Performance).** Die `screens-*.jsx`/`ui.jsx`/`app.jsx` werden **nicht** mehr als `<script type="text/babel">` geladen. Stattdessen transpiliert ein Loader in `index.html` jede Datei **einmal** (Presets `react` + `env`, sourceType `script` — identisch zum alten Babel-Default), cacht das fertige JS in IndexedDB (`zane-precompile`, Key = Pfad + Content-Hash) und führt bei Folgestarts das gecachte JS direkt aus. **Babel Standalone wird nur noch bei Cache-Miss (neue/geänderte Datei) lazy geladen**, `html2canvas` erst beim ersten Screenshot. React läuft als **Production-Build**. Schlägt der Loader fehl, fällt er automatisch auf den alten „Babel transpiliert alles"-Pfad zurück.
  - **Neue `.jsx`-Datei hinzufügen:** an **drei** Stellen eintragen — `SOURCES` im Loader (`index.html`, in Ausführungsreihenfolge), `ASSETS` in `sw.js`, und das `<script>` entfällt (der Loader lädt sie). Content-Hash invalidiert den Cache bei jeder Änderung automatisch.
- **Dateistruktur:**
  - `index.html` — CSS-Variablen, globale Styles, Animationen, Skripte
  - `sw.js` — Service Worker
  - `manifest.json` — PWA-Manifest
  - `src/ui.jsx` — gemeinsame UI-Komponenten (UI-Objekt, Screen, TopBar, TabBar, Btn, Card, …)
  - `src/app.jsx` — Root-Komponente, Auth, Routing, Store-Sync
  - `src/screens-home.jsx`, `src/screens-schedule.jsx`, `src/screens-train.jsx`, `src/screens-lib.jsx`, `src/screens-settings.jsx` — einzelne Screens
  - `src/screens-coaching-core.jsx`, `src/screens-coaching-client.jsx`, `src/screens-coaching-detail.jsx`, `src/screens-coaching-tabs.jsx` — Coaching-UI, aufgeteilt. **`-core` zuerst laden** (definiert die geteilten Top-Level-`const`: React-Aliase `useStateC`/… und `isImprovement`/`isDecline`). Klassische Scripts teilen sich einen globalen Scope, daher: diese `const` **nur in `-core`** deklarieren, nie in den anderen Dateien; alle übrigen Coaching-Symbole sind `function`-Deklarationen (global). Die `window.Screens`-Registrierung steht in `-tabs`.
  - `src/store.js` — Supabase-Lesen/Schreiben, Auth-Funktionen
  - `src/supabase.js` — Supabase JS Client (vendored)
  - `src/whatsnew.js` — Changelog-Historie (`window.WHATS_NEW`-Array, siehe „What's New / Changelog")
  - `supabase/` — Migrationen, Edge Functions, Schema

## Screens & Navigation

- Jeder Screen bekommt `{ store, setStore, go, userId }` als Props.
- Navigation via `go({ name: 'home' })`, `go({ name: 'settings' })` etc.
- Screens werden am Ende der jeweiligen Datei registriert: `Object.assign(window.Screens, { ... })`.

## Store

- Der Store ist ein einzelnes React-State-Objekt in `app.jsx`.
- `syncStore(prev, next, userId)` in `store.js` diff't prev/next und schreibt nur geänderte Felder nach Supabase.
- Store-Updates immer via `setStore(s => ({ ...s, ... }))` — nie direkt mutieren.
- **Neue Settings** müssen immer an drei Stellen in `store.js` ergänzt werden:
  1. `loadFromSupabase` — Mapping DB → Store
  2. `settingsChanged`-Check in `syncStore`
  3. `upsert`-Objekt in `syncStore`

## Theme & Styling

- CSS Custom Properties in `:root` (kein CSS-Framework).
- Akzentfarbe läuft über `--accent`, `--accent-light`, `--accent-deep`, `--accent-rgb`. Keine hardcodierten `rgba(r,g,b,x)`-Werte für die Akzentfarbe — immer `rgba(var(--accent-rgb), x)`.
- Farb-Tokens im Code immer über `UI.xxx` referenzieren (z.B. `UI.gold`, `UI.ink`, `UI.hairStrong`).
- **Border-Radius-Skala** — strikte Hierarchie, nie größere Werte verwenden:
  - `4` — Inputs, kleine Buttons, Tags, Chips
  - `6` — Buttons (`Btn`-Komponente), Container, Cards (Standard)
  - `8` — Große Cards/Sections (maximum für normale UI-Elemente)
  - `999` / `50%` — Pills und kreisförmige Elemente (Dots, Avatare, Toggle-Knöpfe)
  - Ausnahme Toggle-Switch-Track: `13` (bewusst pill-förmig, 44×26px)
  - Werte wie `10`, `12`, `16` sind **nicht erlaubt** — immer auf die nächst-kleinere Stufe reduzieren.
- **Gewichtseinheit:** Angezeigte Gewichts-Labels nie hart `kg`/`KG` schreiben, sondern über `UI.unit()` (gibt `'kg'`/`'lbs'`, Großschreibung via `UI.unit().toUpperCase()`). Reines Anzeige-Label aus `settings.unit` — **keine Umrechnung**, die gespeicherten Zahlen bleiben gleich (lbs-Nutzer geben lbs direkt ein). `app.jsx` spiegelt `settings.unit` bei jedem Render nach `window.__UNIT`. Interne `.kg`-Felder/`field === 'kg'` bleiben immer `kg` (Datenstruktur).
- **Typografie-Klassen** (definiert in `index.html`, nicht neu erfinden):
  - `.micro` — 9px uppercase Label
  - `.micro-gold` — wie micro, aber in Akzentfarbe
  - `.label` — 10px uppercase Label
  - `.num` — JetBrains Mono, für Zahlen
  - `.display` — Big Shoulders Display (700), für Titel
  - `.display-it` — Big Shoulders Display (900)
  - **Hinweis:** Das JS-Token `UI.fontDisplay` (in `ui.jsx`) muss auf dieselbe
    Schrift zeigen wie die `.display`-CSS-Klassen und der Google-Fonts-`<link>`
    in `index.html` (aktuell „Big Shoulders Display"). Wird die Display-Schrift
    gewechselt, alle drei Stellen gemeinsam anpassen, sonst rendern JSX-Titel
    im Fallback.

## Konventionen

- **Supabase-Schreibzugriffe müssen Fehler propagieren.** Der JS-Client wirft bei
  fehlgeschlagenen Writes **nicht**, sondern löst mit `{ error }` auf (auch bei
  Netzwerkfehlern). Jeder Write, der in den Sync-/Diff-Pfad einfließt, läuft
  deshalb über `unwrap(...)` in `store.js` (wirft bei `{ error }`). Nur so greift
  der Retry in `flushSync` (`app.jsx`) und nur so kann eine fehlgeschlagene
  Speicherung nicht als Erfolg durchgehen. In Screens bei direkten Supabase-Calls
  immer `{ error }` prüfen, bevor optimistisch UI/State aktualisiert wird.
- **CI-Gate (kein Build-Step!):** `tools/check-syntax.cjs` transpiliert alle
  Quellen exakt wie der In-App-Loader und `tools/test/store.test.cjs` testet die
  Store-Kernlogik; beide laufen via `.github/workflows/check.yml` bei jedem Push.
  Die JSX-Dateiliste im Check wird aus dem `SOURCES`-Array in `index.html`
  geparst — neue `.jsx` also wie gehabt dort eintragen, dann ist sie automatisch
  mit abgedeckt.
- **DB-Spalten:** `snake_case` (z.B. `accent_color`, `rest_default`)
- **Store-Felder:** `camelCase` (z.B. `accentColor`, `restDefault`)
- **localStorage-Keys:** Einige Settings liegen parallel im localStorage für schnellen Zugriff vor dem Store-Load. Bestehende Keys konsistent halten:
  - `logbook-accent-color`
  - `logbook-push-enabled`
  - `logbook-cycle-week-view`
  - `logbook-whatsnew-seen` — zuletzt gesehene `WHATS_NEW.id` (siehe „What's New / Changelog")
  - `logbook-health-card-order` — vom Nutzer gewählte Reihenfolge der Health-Tab-Karten (per Gerät, kein DB-Sync)
  - `logbook-seen-signups` — vom Admin per „Got it" abgehakte Registrierungen im Account-Tab-Feed (Array von user_ids, per Gerät)

## What's New / Changelog

- **Changelog-Historie in `src/whatsnew.js`** — `window.WHATS_NEW`, ein **Array** von Einträgen, **neueste zuerst**. Jeder Eintrag: `{ id, title, items: [...] }`. `app.jsx` referenziert nur dieses Array; `WhatsNewModal` rendert es. Die Datei ist die vollständige History auf einen Blick.
- **Anzeige-Logik:** Sobald die App nach einem Update `ready` ist (eingeloggt + Daten geladen), zeigt sie **alle noch nicht gesehenen Einträge** — gebündelt in **einer** Karte (jeder Eintrag ein eigener Abschnitt mit Titel + Punkten). So holt ein Rückkehrer, der mehrere Releases übersprungen hat, alles auf einmal nach. Beim Schließen wird die `id` des **neuesten** Eintrags in `localStorage` (`logbook-whatsnew-seen`) gespeichert; alles bis dahin gilt als gesehen. Tracking **pro Gerät** (keine DB). Neue Nutzer / erster Lauf nach Einführung (keine gespeicherte id) sehen nur den **neuesten** Eintrag, nicht die ganze Historie.
- **Leeres Array (`[]`) = es wird nichts angezeigt.** Die Karte erscheint nur für Einträge, die wir bewusst hinzufügen.
- **Workflow — nur auf ausdrückliche Nutzeranfrage** eine Ankündigung einspielen. Niemals ungefragt. Wenn der Nutzer eine wünscht:
  1. Neuen Eintrag **oben** ins Array in `src/whatsnew.js` einfügen — mit **neuer, eindeutiger `id`** (typischerweise im Gleichschritt mit der kommenden SW-Cache-Version, z.B. `'v2.066'`).
  2. **Alte Einträge nie entfernen** — sie sind die Historie, die Rückkehrer nachholen.
  3. SW-Cache-Version in `sw.js` wie üblich bumpen (deployt das Update).
  4. **Texte gut schreiben — das ist der Punkt der Funktion:** Das neue Feature klar und nutzerorientiert erklären — *was* ist neu, *welchen Nutzen* es bringt, *wie* man es benutzt. Knackige Stichpunkte (`items`), kein Tech-Jargon, keine internen Begriffe (Tabellen, Funktionsnamen). Der `title` benennt das Feature, die Punkte vermitteln den Mehrwert. Lieber 2–4 starke Punkte als eine lange Liste.
- Wird ein Release ohne Ankündigungs-Wunsch gemacht, bleibt das Array unverändert (kein neuer Eintrag → keine Karte).
- **`whatsnew.js` ist plain JS** (kein JSX): wird wie `store.js` als normales `<script>` in `index.html` geladen (nicht über den Precompile-Loader) und ist in `ASSETS` in `sw.js` für Offline gelistet — beides bereits eingerichtet.

## Datenbank (Supabase)

Migrationen liegen in `supabase/migrations/` als nummerierte SQL-Dateien (`0001_...sql`, `0002_...sql`, …).

**WICHTIG:** Wenn eine DB-Änderung (neue Spalte, neue Tabelle, neue Funktion) notwendig ist:
1. Eine Migration in `supabase/migrations/` anlegen
2. Den Nutzer explizit darauf hinweisen, dass sie ausgeführt werden muss
3. Die Spalten-Liste bzw. Funktions-Liste unter "Aktuelle Tabellen & Spalten" und "Aktuelle RPCs & Realtime" in dieser Datei aktualisieren
4. `supabase/schema.sql` aktualisieren — diese Datei ist der vollständige aktuelle Snapshot (Tabellen, RLS, Funktionen, Trigger, Realtime) und muss immer mit dem Live-Schema übereinstimmen

**Bei Tabellen-Umbenennung zusätzlich prüfen:**
- `supabase/functions/` — Edge Functions greifen per REST direkt auf Tabellennamen zu (z.B. `dbFetch('zane_pushover_active?...')`). Kein Compiler warnt bei falschen Namen. Alle Funktionen nach alten Tabellennamen durchsuchen und neu deployen.

### Aktuelle Tabellen & Spalten

**`zane_exercises`:** `id` (text), `user_id` (uuid), `name`, `note`, `category` (text), `tags` (text[]), `unilateral` (boolean), `movement_type` (text: 'bilateral'|'unilateral'|'mobility'), `no_weight_reps` (boolean, default false), `equipment` (text), `progression_reps` (int)

**`zane_feature_grants`:** `feature` (text), `email` (text)

**`zane_profiles`:** `id` (uuid), `name` (text), `approved` (boolean, default = `signup_default_approved()` — auto-approved unless the global `zane_app_config.signup_requires_approval` flag is on)

**`zane_app_config`:** `id` (int, singleton = 1), `signup_requires_approval` (boolean, default true), `auto_approve_remaining` (int, nullable — batch budget: when approval is off and this is set, each new signup decrements it via the `signup_consume_budget()` AFTER-INSERT trigger on `zane_profiles`; at 0 the trigger flips `signup_requires_approval` back on and clears the budget). Global admin config (RLS on, only SECURITY DEFINER fns touch it). Drives the `zane_profiles.approved` column default, so flipping it changes future signups only.

**`zane_push_subscriptions`:** `id` (text — endpoint URL), `user_id` (uuid), `endpoint` (text), `p256dh` (text — client EC public key, base64url), `auth` (text — auth secret, base64url), `created_at` (timestamptz) — one row per device per user; managed by `subscribeWebPush`/`unsubscribeWebPush` in `store.js`; 410/404 responses auto-prune stale rows via the `web-push` Edge Function. Migration 0080.

**`zane_pushover_active`:** `id` (text), `nonce` (text)

**`zane_schedules`:** `id` (text), `user_id` (uuid), `name` (text), `days` (jsonb), `archived` (boolean, default false), `versions` (jsonb, default []) — array of `{ validFrom: 'YYYY-MM-DD', days: [...] }` sorted newest first; used for plan-change-from-date versioning

**`zane_sessions`:** `id` (text), `user_id` (uuid), `schedule_id`, `day_id`, `day_name` (text), `date`, `started_at`, `ended` (timestamptz), `entries` (jsonb — **legacy, not written anymore**; seit Migration 0058 sind `zane_session_entries`/`zane_sets` die alleinige Quelle, alte Zeilen behalten ihren JSONB-Stand), `duration_minutes` (int), `feel` (text: easy|good|hard|very_hard|max)

**`zane_session_entries`:** `id` (text), `session_id` (text), `user_id` (uuid), `entry_idx` (int), `ex_id` (text), `name` (text), `planned_sets` (int), `planned_reps` (int), `planned_reps_per_set` (integer[]), `note` (text), `superset_group` (text)

**`zane_sets`:** `id` (text), `session_id` (text), `entry_id` (text), `user_id` (uuid), `set_idx` (int), `kg` (numeric), `reps` (int), `reps_l` (int), `reps_r` (int), `done` (boolean), `skipped` (boolean), `warmup` (boolean), `updated_at` (timestamptz)

**`zane_coaching`:** `id` (text), `coach_id` (uuid), `client_id` (uuid), `status` (text: pending|active), `created_at` (timestamptz), `checkin_requested_at` (timestamptz, nullable), `checkin_enabled` (boolean, default true), `checkin_schema` (jsonb, nullable — coach-defined form schema; null = use `CHECKIN_DEFAULT_SCHEMA`) — Sonderfall **Self-Coaching**: eine Zeile mit `coach_id == client_id` (id-Präfix `self_`) bedeutet „be your own coach". Sie wird aus allen Coach-/Client-Listen herausgefiltert (`get_coach_info`, `get_coaching_clients`, `get_coach_clients_status`, `get_coach_checkin_status`) und ermöglicht das volle Coaching-Dashboard für die eigenen Daten.

**`zane_coaching_threads`:** `id` (text), `coaching_id` (text), `name` (text), `created_by` (uuid), `created_at` (timestamptz)

**`zane_coaching_notes`:** `id` (text), `coaching_id` (text), `author_id` (uuid), `thread_id` (text, nullable → references zane_coaching_threads), `type` (text: session|plan|general|change), `entity_id` (text, nullable), `entity_name` (text, nullable), `body` (text), `created_at` (timestamptz), `read_at` (timestamptz, nullable)

**`zane_coaching_macros`:** `id` (text), `coaching_id` (text), `set_by` (uuid), `set_at` (timestamptz), `calories_training` (int), `protein_training` (int), `carbs_training` (int), `fat_training` (int), `calories_rest` (int), `protein_rest` (int), `carbs_rest` (int), `fat_rest` (int)

**`zane_checkins`:** `id` (text), `coaching_id` (text), `client_id` (uuid), `week_start` (date), `checked_in_at` (timestamptz), `responses` (jsonb, nullable — all field values keyed by field key, primary storage since Migration 0065), `weight_today` (numeric), `weight_avg_last_week` (numeric), `off_plan_notes` (text), `hydration_ml` (int), `days_trained` (int), `performance_vs_last_week` (text: worse|same|improved), `steps` (int), `cardio_minutes` (int), `cardio_distance_m` (int), `cardio_pace_feeling` (int 1–6), `cardio_effort` (int 1–10), `goal_note` (text), `hunger` (int), `sleep_quality` (int), `life_stress` (int), `work_stress` (int), `tiredness` (int), `issues_notes` (text), `general_note` (text) — UNIQUE (coaching_id, week_start)

**`zane_cardio_logs`:** `id` (text), `user_id` (uuid), `date` (text, YYYY-MM-DD), `type` (text, nullable), `duration_minutes` (int), `distance_m` (numeric, nullable), `pace_feeling` (int 1–6, nullable), `effort` (int 1–10, nullable), `note` (text, nullable), `created_at` (timestamptz)

**`zane_daily_logs`:** `id` (text), `user_id` (uuid), `date` (text, YYYY-MM-DD), `weight` (numeric, nullable), `steps` (int, nullable), `calories` (int, nullable), `protein` (int, nullable), `carbs` (int, nullable — always **total** carbs), `fat` (int, nullable), `fiber` (int, nullable — only set in net-carb mode; calories then = `(protein + carbs − fiber)×4 + fat×9`; Migration 0073), `water_ml` (int, nullable), `note` (text, nullable), `adherence` (numeric, nullable — macro-adherence % persisted **at save time**; computed on total carbs, fiber does not affect it), `targets_snap` (jsonb, nullable — `{ protein, carbs, fat, calories, dayType }` snapshot so a later target change never rewrites past adherence), `off_plan_note` (text, nullable — daily off-plan note; store field `offPlanNote`; `dailyLogsWeekPrefill` accumulates all daily notes into `off_plan_notes` with "DD.MM.YYYY - " prefix; Migration 0079), `daily_coach_fields` (jsonb, nullable — arbitrary key→value map for coach-configured daily tracking fields; keys match `checkin_schema` field keys where `show_in_health_log: true`; store field `coachFields`; Migration 0078), `created_at` (timestamptz) — UNIQUE (user_id, date). One row per day, source for the Health tab. Synced via the same diff model as cardio logs (UI mutates `store.dailyLogs` via `setStore`; `syncStore` writes). RLS: own rows + coach-of-client reads (so `loadClientStore` fills `clientStore.dailyLogs` for the coach „Daily" tab — no extra RPC). Migration 0069.

**`zane_skips`:** `id` (text), `user_id` (uuid), `date` (text), `day_id` (text), `day_name` (text), `skip_reason` (text), `skipped_at` (timestamptz)

**`zane_user_settings`:** `user_id` (uuid), `active_schedule_id` (text), `cycle_index` (int), `cycle_start_date` (text), `last_advanced_date` (date), `week_plan_start_date` (date), `in_progress_session_id` (text), `unit` (text), `rest_default`, `rest_big`, `rest_medium`, `rest_small` (int), `push_enabled` (boolean), `pushover_user_key` (text), `cycle_week_view` (boolean), `accent_color` (text), `dark_mode` (text), `tempo_enabled` (boolean), `tempo_eccentric` (numeric), `tempo_concentric` (numeric), `smart_progression` (boolean), `progression_range_top` (int), `equipment_config` (jsonb), `custom_day_types` (text[]), `reminder_enabled` (boolean), `reminder_time` (text, HH:MM), `next_reminder_at` (timestamptz), `show_warmup_in_summary` (boolean), `show_coaching_tab` (boolean), `be_your_own_coach` (boolean), `session_timeout_minutes` (int, default 90), `auto_close_notify` (jsonb, nullable — `{ dayName, date, durationMinutes }`, written by edge function, cleared by app on first read), `macro_targets` (jsonb, nullable — personal Health-tab targets `{ proteinTraining, carbsTraining, fatTraining, caloriesTraining, proteinRest, carbsRest, fatRest, caloriesRest }`; store field `macroTargets`), `show_health_tab` (boolean, default false — pins the Health tab; store field `showHealthTab`), `onboarding_completed` (boolean, default false — set after welcome tour or first session; store field `onboardingCompleted`), `net_carbs` (boolean, default false — Health-tab daily-log carb mode: net-carb tracking adds a fiber field; store field `netCarbs`; Migration 0073)

### Aktuelle RPCs & Realtime

**`check_active_users_access()`** → `boolean` — gibt true zurück wenn der aufrufende User das `active_users`-Feature hat (Admin oder per `zane_feature_grants`)

**`get_active_users_grants()`** → `TABLE(email text)` — listet alle Emails mit `active_users`-Grant (nur Admin)

**`set_active_users_grant(p_email text, p_granted boolean)`** → `void` — erteilt oder entzieht den `active_users`-Grant (nur Admin)

**`get_signup_config()`** → `TABLE(requires_approval boolean, auto_approve_remaining int)` / **`set_signup_requires_approval(p_value boolean)`** → `void` (setzt den Master-Toggle, löscht dabei jedes Batch-Budget) / **`set_auto_approve_budget(p_count int)`** → `void` (öffnet die Registrierung für `p_count` Signups, danach Selbst-Sperre; `p_count ≤ 0` sperrt sofort) — alle nur Admin. **`get_signup_requires_approval()`** → `boolean` existiert weiter (Legacy). **`signup_default_approved()`** → `boolean` (SECURITY DEFINER) ist die invertierte Flag und dient als Column-Default für `zane_profiles.approved`; **`signup_consume_budget()`** ist die Trigger-Funktion (AFTER INSERT auf `zane_profiles`), die das Budget runterzählt und bei 0 wieder zusperrt.

**`get_recent_signups(p_limit int default 50)`** → `TABLE(user_id uuid, name text, email text, created_at timestamptz, approved boolean)` — jüngste Registrierungen (approved + pending) für den Admin-„Recent sign-ups"-Feed im Account-Tab (nur Admin). „Got it"-Dismiss pro Gerät via localStorage `logbook-seen-signups`. Migration 0075.

**`get_active_sessions_overview()`** → `TABLE(...)` — aktive + kürzlich beendete Sessions aller User inkl. Sets/Dauer-Statistik (gated by feature grant)

**`get_active_session_detail(p_user_id uuid, p_session_id text)`** → `TABLE(...)` — Volldetail einer Session inkl. Historienvergleich (avg. Dauer, Sets, letzte Session; gated by feature grant). Gibt zusätzlich die `unit` ('kg'|'lbs') des Trainierenden zurück (Migration 0068), damit die Coach-Spectator-/Comparison-Ansicht Gewichte im Einheiten-Label des Clients zeigt — gespeicherte Zahlen werden nie umgerechnet.

**`sync_sets_batch(p_sets jsonb)`** → `void` — batch-upsert sets with updated_at guard; only updates a row if the incoming updated_at is newer than what's stored (prevents stale kbApply writes from overwriting completed sets)

**`zane_entries_json(p_session_id text)`** → `jsonb` — baut die store-förmige (camelCase) `entries`-Array einer Session aus den relationalen Tabellen (`zane_session_entries`/`zane_sets`). Quelle der Wahrheit seit Migration 0058; von `get_active_session_detail`/`get_active_sessions_overview` genutzt, damit die Coach-/Spectator-Ansicht nicht mehr vom Legacy-JSONB abhängt. Der Client schreibt das JSONB nicht mehr (`sessionToRow` in `store.js` lässt `entries` aus).

**Serverseitige History-Aggregate (Migrationen 0059/0060, SECURITY INVOKER, optional `p_user_id` für Coach-Zugriff):**
- **`get_exercise_best_e1rm(p_user_id?)`** → `TABLE(ex_id, best_e1rm)` — bestes All-Time-e1RM (Epley) je Übung über beendete Sessions. Beim Boot geladen und als `store.exerciseBests` gecacht; `bestE1rmForExercise` = max(Aggregat, lokal geladenes Fenster). Beim Training-Mount refresht (`refreshExerciseBests`).
- **`get_exercise_history(p_ex_id, p_day_id?, p_limit?, p_user_id?)`** → `TABLE(session_id, day_id, date, ended, sets jsonb)` — jüngste beendete Sessions mit dieser Übung. Genutzt von `fetchSeedEntries` (Seeds/Progression beim Session-Start, nur wenn das lokale Fenster < 3 Treffer hat), der „Last time"-Karte im Training (Fallback) und beiden Exercise-History-Ansichten (lokal sofort, Server erweitert auf volle Historie).
- **`get_user_volume_stats(p_user_id?)`** → `TABLE(session_count, total_volume, total_minutes, total_done_sets)` — All-Time-Summen. Vom Client derzeit **nicht** aufgerufen: Die Stats summieren lokal über `totalVolume()`/`doneSetCount()`, die für gefensterte Sessions auf die `get_session_stats`-Aggregate zurückfallen (exakt, offline-fähig, schließt frisch beendete Sessions sofort ein).
- **`get_session_stats(p_user_id?)`** → `TABLE(session_id, exercise_count, done_sets, volume)` — per-Session-Aggregate aller beendeten Sessions (Migration 0060). Beim Boot geladen und als `aggVolume`/`aggDoneSets`/`aggExercises` an die Sessions gehängt; `totalVolume`/`doneSetCount` nutzen sie als Fallback für Sessions ohne geladene Sets (History-Liste, Best Session, Coach-Listen). Semantik = Client-Logik für beendete Sessions (done-Flag nicht erforderlich). `sessionToRow` filtert die `agg*`-Felder beim Sync wieder heraus.

**`auto-close-sessions`** (Edge Function) — schließt abgelaufene offene Sessions: kein Sets → Session + Entries löschen (butt start); mit Sets → `ended` = letztes `updated_at` der Sets, `duration_minutes` berechnen, `in_progress_session_id` clearen; optional Pushover-Notification. Wird per Cron alle 15 Minuten aufgerufen (Supabase Dashboard → Edge Functions → Schedule). Timeout pro User in `session_timeout_minutes` (default 90 min).

**`get_coaching_clients()`** → `TABLE(coaching_id text, client_id uuid, client_email text, client_name text, status text, checkin_enabled boolean)` — listet alle Clients des aufrufenden Coaches inkl. `checkin_enabled`-Flag; Self-Coaching-Zeilen ausgeschlossen

**`get_coach_clients_status()`** → `TABLE(client_id uuid, in_progress_session_id text)` — gibt live-Trainingsstatus aller aktiven Clients eines Coaches zurück (SECURITY DEFINER, umgeht RLS auf zane_user_settings); Self-Coaching-Zeilen (`coach_id == client_id`) ausgeschlossen

**`enable_self_coaching()`** → `text` — legt (idempotent) eine Self-Coaching-Zeile (`coach_id = client_id = auth.uid()`, status active, id-Präfix `self_`) an und gibt deren id zurück. Aktiviert „be your own coach"

**Realtime:** `zane_coaching` und `zane_coaching_notes` sind in der `supabase_realtime`-Publikation — ermöglicht Live-Coaching-Einladungen und -Nachrichten. **Cross-Device Live-Sync laufender Sessions wurde entfernt** (der lokale Store ist die alleinige Quelle für eine laufende Session; ein Coach sieht die Live-Session eines Clients per Polling via `get_active_session_detail`, nicht über Realtime). `subscribeToChanges(userId, onCoachingNote, onCoachingInvite)` abonniert nur noch die Coaching-Tabellen.

## History-Windowing (Boot lädt nicht mehr die ganze Historie)

Seit v2.085 lädt der Boot **konstant viele Sets**, unabhängig vom Account-Alter
(Phase 2 von Migration 0059; per-Session-Aggregate aus Migration 0060):

- **Boot-Fenster:** `loadFromSupabase` lädt Session-*Metadaten* weiterhin
  **vollständig** (Streaks/Kalender brauchen die Datumsliste), aber
  `zane_session_entries`/`zane_sets` nur für die letzten `HISTORY_WINDOW_DAYS`
  (70 Tage, deckt den 8-Wochen-Chart) **plus** die In-Progress-Session.
  Der `entries`-JSONB-Select und der JSONB-Fallback sind entfernt (alle
  Alt-Sessions wurden in Migration 0031 relational backgefüllt).
- **Sessions außerhalb des Fensters** haben `entries: []` und tragen die
  Aggregate `aggVolume`/`aggDoneSets`/`aggExercises` (aus `get_session_stats`).
  `totalVolume()`/`doneSetCount()` fallen automatisch darauf zurück;
  `aggExercises > 0` unterscheidet eine gefensterte von einer echt leeren
  Session. Die Session-Detail-Ansichten (eigene + Coach) laden die Sets bei
  Bedarf nach (`fetchSessionEntries`, RLS: own + coach-of).
- **PR-Erkennung:** `bestE1rmForExercise` = max(`store.exerciseBests`-Aggregat,
  lokal geladenes Fenster) — deckt auch Sessions ab, die seit dem Boot lokal
  beendet wurden. Das Aggregat wird beim Training-Mount refresht.
- **Seeds/Progression:** `fetchSeedEntries` fragt `get_exercise_history` nur für
  Übungen, deren lokales Fenster < 3 Sessions hat (Normalfall: 0 RPCs, komplett
  offline-fähig); Server- und Lokal-Treffer werden per Session-Id dedupliziert
  gemerged. Die Session-Start-Flows (`startSession`, „Log"-Banner,
  Not-logged-Modal) awaiten das **vor** dem Anlegen der Session.
- **Merge in `app.jsx`:** Der Sessions-Teil des Cache-first-Merges ist als
  `LB.mergeSessions` in `store.js` extrahiert (unit-getestet). Die „Server hat
  sie nicht mehr → löschen"-Logik arbeitet auf der weiterhin vollständigen
  Metadaten-Liste; **gecachte Entries** von Sessions außerhalb des Fensters
  bleiben erhalten (Bestandsgeräte behalten ihre volle Offline-Historie).
  Lokale Einträge, die der Server nicht hat, werden nur behalten, wenn sie
  **nie bestätigt gesynct** waren (nicht in der persistierten Sync-Base aus
  `loadBase`) — sonst würde ein Gerät auf einem anderen Gerät Gelöschtes
  wieder hochsyncen (Resurrection). Gilt für Sessions, Exercises, Schedules
  und Skips; ohne Base (Alt-Cache) wird konservativ behalten.
- **Offline:** Aggregate + Fenster liegen im localStorage-Store-Cache; ohne
  Netz laufen PR-Erkennung/Stats/Listen aus dem Cache. Die RPC-Helfer
  (`fetchSeedEntries` etc.) fallen bei Fehlern still auf lokale Daten zurück.
- **Bekannte, akzeptierte Degradationen** (nur frische Geräte, Sessions älter
  als das Fenster): Set-für-Set-Vergleiche/PR-Sterne in **alten**
  Session-Details vergleichen nur gegen Fenster+Cache; `setsPerMuscle` beim
  Zurückblättern in alte Cycles ist leer; die „Recent"-Liste der Library
  umfasst nur das Fenster.
- **Spalte zuletzt droppen:** `zane_sessions.entries` erst per separater
  Migration entfernen — Boot selektiert sie nicht mehr, aber erst droppen, wenn
  alle Clients auf ≥ v2.085 sind (alte SW-Caches laden sonst noch den alten
  Boot-Code, dessen Select dann 400 würfe).

## Deployment

PWA, erreichbar unter `/training/`. Service Worker in `sw.js`.

**SW-Cache-Version (`const CACHE = 'zane-vX.XXX'` in `sw.js`) nur auf ausdrückliche Aufforderung erhöhen.** Nicht automatisch bei jedem Commit — mit vielen aktiven Usern würde jedes kleinste Code-Update einen Update-Banner auslösen. Format `zane-vMAJOR.MINOR`, fortlaufend hochgezählt (z.B. `zane-v2.350` → `zane-v2.351`).

**Nach einem Cache-Bump die neue Versionsnummer im Chat melden** — z.B. „SW-Cache → zane-v2.351".
