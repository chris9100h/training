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
  - `src/screens-home.jsx`, `src/screens-schedule.jsx`, `src/screens-train.jsx`, `src/screens-lib.jsx` — einzelne Screens
  - `src/store.js` — Supabase-Lesen/Schreiben, Auth-Funktionen
  - `src/supabase.js` — Supabase JS Client (vendored)
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
- **Gewichtseinheit:** Angezeigte Gewichts-Labels nie hart `kg`/`KG` schreiben, sondern über `UI.unit()` (gibt `'kg'`/`'lbs'`, Großschreibung via `UI.unit().toUpperCase()`). Reines Anzeige-Label aus `settings.unit` — **keine Umrechnung**, die gespeicherten Zahlen bleiben gleich (lbs-Nutzer geben lbs direkt ein). `app.jsx` spiegelt `settings.unit` bei jedem Render nach `window.__UNIT`. Interne `.kg`-Felder/`field === 'kg'` bleiben immer `kg` (Datenstruktur).
- **Typografie-Klassen** (definiert in `index.html`, nicht neu erfinden):
  - `.micro` — 9px uppercase Label
  - `.micro-gold` — wie micro, aber in Akzentfarbe
  - `.label` — 10px uppercase Label
  - `.num` — JetBrains Mono, für Zahlen
  - `.display` — Cormorant Garamond, für Titel
  - `.display-it` — Cormorant Garamond italic

## Konventionen

- **DB-Spalten:** `snake_case` (z.B. `accent_color`, `rest_default`)
- **Store-Felder:** `camelCase` (z.B. `accentColor`, `restDefault`)
- **localStorage-Keys:** Einige Settings liegen parallel im localStorage für schnellen Zugriff vor dem Store-Load. Bestehende Keys konsistent halten:
  - `logbook-accent-color`
  - `logbook-push-enabled`
  - `logbook-cycle-week-view`
  - `logbook-whatsnew-seen` — zuletzt gesehene `WHATS_NEW.id` (siehe „What's New / Changelog")

## What's New / Changelog

- **`WHATS_NEW`-Konstante in `src/app.jsx`** (Default `null`). Steuert eine einmalige „What's New"-Karte (`WhatsNewModal`), die dem Nutzer nach einem Update neue Features vorstellt. Form: `{ id, title, items: [...] }`.
- **Anzeige-Logik:** Sobald die App nach einem Update den Zustand `ready` erreicht (eingeloggt + Daten geladen) und `WHATS_NEW.id` noch nicht in `localStorage` (`logbook-whatsnew-seen`) steht, erscheint die Karte **genau einmal**. Beim Schließen wird die `id` gespeichert → erscheint nie wieder. Tracking ist **pro Gerät** (localStorage, keine DB).
- **Default `null` = es wird nichts angezeigt.** Die Karte erscheint nur für Releases, die wir bewusst annotieren.
- **Workflow — nur auf ausdrückliche Nutzeranfrage** eine neue Nachricht einspielen. Niemals ungefragt eine Ankündigung setzen. Wenn der Nutzer eine wünscht:
  1. `WHATS_NEW` in `app.jsx` auf `{ id, title, items }` setzen — mit **neuer, eindeutiger `id`** (im Gleichschritt mit der SW-Cache-Version, z.B. `'v2.065'`), damit die Karte genau einmal pro Nutzer erscheint.
  2. SW-Cache-Version in `sw.js` wie üblich bumpen.
  3. **Texte gut schreiben — das ist der Punkt der Funktion:** Das neue Feature klar und nutzerorientiert erklären — *was* ist neu, *welchen Nutzen* es bringt, *wie* man es benutzt. Knackige Stichpunkte (`items`), kein Tech-Jargon, keine internen Begriffe (Tabellen, Funktionsnamen). Der `title` benennt das Feature, die Punkte vermitteln den Mehrwert. Lieber 2–4 starke Punkte als eine lange Liste.
- Wird ein Release ohne Ankündigungs-Wunsch gemacht, bleibt `WHATS_NEW = null` (keine Karte).

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

**`zane_exercises`:** `id` (text), `user_id` (uuid), `name`, `note`, `category` (text), `tags` (text[]), `unilateral` (boolean), `equipment` (text), `progression_reps` (int)

**`zane_feature_grants`:** `feature` (text), `email` (text)

**`zane_profiles`:** `id` (uuid), `name` (text)

**`zane_pushover_active`:** `id` (text), `nonce` (text)

**`zane_schedules`:** `id` (text), `user_id` (uuid), `name` (text), `days` (jsonb), `archived` (boolean, default false), `versions` (jsonb, default []) — array of `{ validFrom: 'YYYY-MM-DD', days: [...] }` sorted newest first; used for plan-change-from-date versioning

**`zane_sessions`:** `id` (text), `user_id` (uuid), `schedule_id`, `day_id`, `day_name` (text), `date`, `started_at`, `ended` (timestamptz), `entries` (jsonb), `duration_minutes` (int), `feel` (text: easy|good|hard|very_hard|max)

**`zane_session_entries`:** `id` (text), `session_id` (text), `user_id` (uuid), `entry_idx` (int), `ex_id` (text), `name` (text), `planned_sets` (int), `planned_reps` (int), `planned_reps_per_set` (integer[]), `note` (text), `superset_group` (text)

**`zane_sets`:** `id` (text), `session_id` (text), `entry_id` (text), `user_id` (uuid), `set_idx` (int), `kg` (numeric), `reps` (int), `reps_l` (int), `reps_r` (int), `done` (boolean), `skipped` (boolean), `warmup` (boolean), `updated_at` (timestamptz)

**`zane_coaching`:** `id` (text), `coach_id` (uuid), `client_id` (uuid), `status` (text: pending|active), `created_at` (timestamptz), `checkin_requested_at` (timestamptz, nullable), `checkin_enabled` (boolean, default true) — Sonderfall **Self-Coaching**: eine Zeile mit `coach_id == client_id` (id-Präfix `self_`) bedeutet „be your own coach". Sie wird aus allen Coach-/Client-Listen herausgefiltert (`get_coach_info`, `get_coaching_clients`, `get_coach_clients_status`, `get_coach_checkin_status`) und ermöglicht das volle Coaching-Dashboard für die eigenen Daten.

**`zane_coaching_threads`:** `id` (text), `coaching_id` (text), `name` (text), `created_by` (uuid), `created_at` (timestamptz)

**`zane_coaching_notes`:** `id` (text), `coaching_id` (text), `author_id` (uuid), `thread_id` (text, nullable → references zane_coaching_threads), `type` (text: session|plan|general|change), `entity_id` (text, nullable), `entity_name` (text, nullable), `body` (text), `created_at` (timestamptz), `read_at` (timestamptz, nullable)

**`zane_coaching_macros`:** `id` (text), `coaching_id` (text), `set_by` (uuid), `set_at` (timestamptz), `calories_training` (int), `protein_training` (int), `carbs_training` (int), `fat_training` (int), `calories_rest` (int), `protein_rest` (int), `carbs_rest` (int), `fat_rest` (int)

**`zane_checkins`:** `id` (text), `coaching_id` (text), `client_id` (uuid), `week_start` (date), `checked_in_at` (timestamptz), `weight_today` (numeric), `weight_avg_last_week` (numeric), `off_plan_notes` (text), `hydration_ml` (int), `days_trained` (int), `performance_vs_last_week` (text: worse|same|improved), `steps` (int), `cardio_minutes` (int), `cardio_distance_m` (int), `cardio_pace_feeling` (int 1–6), `cardio_effort` (int 1–10), `goal_note` (text), `hunger` (int), `sleep_quality` (int), `life_stress` (int), `work_stress` (int), `tiredness` (int), `issues_notes` (text), `general_note` (text) — UNIQUE (coaching_id, week_start)

**`zane_skips`:** `id` (text), `user_id` (uuid), `date` (text), `day_id` (text), `day_name` (text), `skip_reason` (text), `skipped_at` (timestamptz)

**`zane_user_settings`:** `user_id` (uuid), `active_schedule_id` (text), `cycle_index` (int), `cycle_start_date` (text), `last_advanced_date` (date), `week_plan_start_date` (date), `in_progress_session_id` (text), `unit` (text), `rest_default`, `rest_big`, `rest_medium`, `rest_small` (int), `push_enabled` (boolean), `pushover_user_key` (text), `cycle_week_view` (boolean), `accent_color` (text), `dark_mode` (text), `tempo_enabled` (boolean), `tempo_eccentric` (numeric), `tempo_concentric` (numeric), `smart_progression` (boolean), `progression_range_top` (int), `equipment_config` (jsonb), `custom_day_types` (text[]), `reminder_enabled` (boolean), `reminder_time` (text, HH:MM), `next_reminder_at` (timestamptz), `show_warmup_in_summary` (boolean), `show_coaching_tab` (boolean), `be_your_own_coach` (boolean), `session_timeout_minutes` (int, default 90), `auto_close_notify` (jsonb, nullable — `{ dayName, date, durationMinutes }`, written by edge function, cleared by app on first read)

### Aktuelle RPCs & Realtime

**`check_active_users_access()`** → `boolean` — gibt true zurück wenn der aufrufende User das `active_users`-Feature hat (Admin oder per `zane_feature_grants`)

**`get_active_users_grants()`** → `TABLE(email text)` — listet alle Emails mit `active_users`-Grant (nur Admin)

**`set_active_users_grant(p_email text, p_granted boolean)`** → `void` — erteilt oder entzieht den `active_users`-Grant (nur Admin)

**`get_active_sessions_overview()`** → `TABLE(...)` — aktive + kürzlich beendete Sessions aller User inkl. Sets/Dauer-Statistik (gated by feature grant)

**`get_active_session_detail(p_user_id uuid, p_session_id text)`** → `TABLE(...)` — Volldetail einer Session inkl. Historienvergleich (avg. Dauer, Sets, letzte Session; gated by feature grant)

**`sync_sets_batch(p_sets jsonb)`** → `void` — batch-upsert sets with updated_at guard; only updates a row if the incoming updated_at is newer than what's stored (prevents stale kbApply writes from overwriting completed sets)

**`auto-close-sessions`** (Edge Function) — schließt abgelaufene offene Sessions: kein Sets → Session + Entries löschen (butt start); mit Sets → `ended` = letztes `updated_at` der Sets, `duration_minutes` berechnen, `in_progress_session_id` clearen; optional Pushover-Notification. Wird per Cron alle 15 Minuten aufgerufen (Supabase Dashboard → Edge Functions → Schedule). Timeout pro User in `session_timeout_minutes` (default 90 min).

**`get_coaching_clients()`** → `TABLE(coaching_id text, client_id uuid, client_email text, client_name text, status text, checkin_enabled boolean)` — listet alle Clients des aufrufenden Coaches inkl. `checkin_enabled`-Flag; Self-Coaching-Zeilen ausgeschlossen

**`get_coach_clients_status()`** → `TABLE(client_id uuid, in_progress_session_id text)` — gibt live-Trainingsstatus aller aktiven Clients eines Coaches zurück (SECURITY DEFINER, umgeht RLS auf zane_user_settings); Self-Coaching-Zeilen (`coach_id == client_id`) ausgeschlossen

**`enable_self_coaching()`** → `text` — legt (idempotent) eine Self-Coaching-Zeile (`coach_id = client_id = auth.uid()`, status active, id-Präfix `self_`) an und gibt deren id zurück. Aktiviert „be your own coach"

**Realtime:** `zane_coaching` und `zane_coaching_notes` sind in der `supabase_realtime`-Publikation — ermöglicht Live-Coaching-Einladungen und -Nachrichten. **Cross-Device Live-Sync laufender Sessions wurde entfernt** (der lokale Store ist die alleinige Quelle für eine laufende Session; ein Coach sieht die Live-Session eines Clients per Polling via `get_active_session_detail`, nicht über Realtime). `subscribeToChanges(userId, onCoachingNote, onCoachingInvite)` abonniert nur noch die Coaching-Tabellen.

## Deployment

PWA, erreichbar unter `/training/`. Service Worker in `sw.js`.

**Bei jedem Commit die SW-Cache-Version in `sw.js` um 1 erhöhen** (erste Zeile: `const CACHE = 'zane-vX.XXX'`). Das stellt sicher, dass Nutzer nach einem Deploy automatisch frische Assets bekommen. Aktuelles Format: `zane-v1.501`, nächster Commit `zane-v1.502`, dann `zane-v1.503`, usw.

**Nach jedem Cache-Bump die neue Versionsnummer im Chat melden** — z.B. „SW-Cache → zane-v1.922".
