# Logbook: Projektkontext für Claude

## Sprache

- **Konversation mit dem Nutzer:** Deutsch
- **App-UI, Code, Commits, Kommentare:** Englisch
- **Keine Em-Dashes (—). Niemals.** Der Nutzer hasst sie. In keinem Output verwenden: nicht in Chat-Antworten, App-Texten, Code-Kommentaren, Commits, What's-New oder Doku. Stattdessen Komma, Doppelpunkt, Klammern, oder den Satz mit Punkt aufteilen.

## Referenzdoku (bei Bedarf lesen, nicht raten)

Diese Datei enthält die verbindlichen Regeln und den Überblick; sie bewusst schlank halten. Detailwissen gehört in `docs/`:

- **`docs/database.md`**: vollständige Tabellen-/Spalten-Referenz, alle RPCs, RLS-Notizen, Realtime. Die Spalten-Doku enthält die Verhaltens-Contracts der App. **Vor jeder Arbeit an Migrationen, `store.js`-Sync oder Features mit DB-Berührung den passenden Abschnitt lesen.**
- **`docs/internals.md`**: Deep-Dives zu Precompile-Loader, System-Übungskatalog (`exercise-db.js`), Plan-Setup-Wizard und History-Windowing/Boot-Merge. Vor Änderungen an diesen Bereichen lesen.

## Architektur

- **Kein Build-Step, keine npm-Pakete.** Abhängigkeiten laufen über CDN-Scripts in `index.html` (React 18 Production-Build, Babel Standalone, Supabase JS).
- **Kein import/export.** Alles läuft über den globalen `window`-Namespace:
  - `window.LB`: Store-Funktionen (aus `store.js`)
  - `window.Screens`: Screen-Komponenten (aus den `screens-*.jsx` Dateien)
  - `window.UI`: UI-Primitives und Farb-Tokens (aus `ui.jsx`)
  - `window.ACCENT_PALETTE`, `window.applyAccentColor`: Akzentfarben-System (aus `index.html`)
- **Babel Standalone:** JSX funktioniert, TypeScript nicht. Syntaxfehler crashen die gesamte App ohne hilfreiche Fehlermeldung.
- **Precompile-Loader:** `ui.jsx`/`app.jsx`/`screens-*.jsx` werden nicht per `<script type="text/babel">` geladen, sondern von einem Loader in `index.html` einmal transpiliert und in IndexedDB gecacht (Details: `docs/internals.md`). Praktische Regeln:
  - **Neue `.jsx`-Datei** in `SOURCES` im Loader (`index.html`, in Ausführungsreihenfolge) **und** in `ASSETS` (`sw.js`) eintragen; **kein** `<script>`-Tag anlegen (der Loader lädt sie).
  - Ändert sich `PRESETS`/`PRESET_TAG` im Loader, `tools/check-syntax.cjs` mit denselben Presets nachziehen.
- **Dateistruktur:**
  - `index.html`: CSS-Variablen, globale Styles, Animationen, Loader, Skripte
  - `sw.js`: Service Worker · `manifest.json`: PWA-Manifest
  - `src/ui.jsx`: gemeinsame UI-Komponenten (UI-Objekt, Screen, TopBar, TabBar, Btn, Card, …)
  - `src/app.jsx`: Root-Komponente, Auth, Routing, Store-Sync
  - `src/screens-home.jsx`, `-schedule`, `-train`, `-lib`, `-settings`: die Haupt-Screens
  - `src/screens-health.jsx`: Health-Tab (Daily Log: Gewicht/Makros/Steps/Wasser, Glucose, Adherence)
  - `src/screens-cardio.jsx`: Cardio-Pläne und -Logs
  - `src/screens-onboarding.jsx`: Welcome-Tour / Onboarding
  - `src/screens-coaching-core.jsx`, `-client`, `-detail`, `-tabs`: Coaching-UI. **`-core` zuerst laden**: definiert die geteilten Top-Level-`const` (React-Aliase `useStateC`/… und `isImprovement`/`isDecline`). Klassische Scripts teilen sich einen globalen Scope, daher diese `const` **nur in `-core`** deklarieren; alle übrigen Coaching-Symbole sind globale `function`-Deklarationen. Die `window.Screens`-Registrierung steht in `-tabs`.
  - `src/store.js`: Supabase-Lesen/Schreiben, Auth-Funktionen
  - `src/supabase.js`: Supabase JS Client (vendored)
  - `src/whatsnew.js`: Changelog-Historie (`window.WHATS_NEW`, siehe „What's New / Changelog"); plain JS, normales `<script>`
  - `src/exercise-db.js`: read-only System-Übungskatalog `window.SYSTEM_EXERCISES`; plain JS, normales `<script>`, in `ASSETS`. Merkregel: Pläne/Sessions halten **nie** `sys_`-Ids, beim Übernehmen/Picken entsteht immer eine editierbare User-Kopie in `store.exercises` (Details: `docs/internals.md`).
  - `supabase/`: Migrationen, Edge Functions, Schema

## Screens & Navigation

- Jeder Screen bekommt `{ store, setStore, go, userId }` als Props.
- Navigation via `go({ name: 'home' })`, `go({ name: 'settings' })` etc.
- Screens werden am Ende der jeweiligen Datei registriert: `Object.assign(window.Screens, { ... })`.
- **Plan-Setup-Wizard** (`schedule-new`-Route): `ScheduleNewScreen` rendert nur `PlanWizard`, einen geführten Skelett-Builder (baut per `LB.buildPlanSkeleton` das Schedule-Objekt und navigiert zu `schedule-edit`). Invarianten (dynamische Steps, Split-Presets, Weekday-Guard, Custom Days, z-9998-Overlay-Fallen): `docs/internals.md`.

## Store

- Der Store ist ein einzelnes React-State-Objekt in `app.jsx`.
- `syncStore(prev, next, userId)` in `store.js` diff't prev/next und schreibt nur geänderte Felder nach Supabase.
- Store-Updates immer via `setStore(s => ({ ...s, ... }))`, nie direkt mutieren.
- **Neue Settings** müssen immer an drei Stellen in `store.js` ergänzt werden:
  1. `loadFromSupabase`: Mapping DB → Store
  2. `settingsChanged`-Check in `syncStore`
  3. `upsert`-Objekt in `syncStore`

## Theme & Styling

- CSS Custom Properties in `:root` (kein CSS-Framework).
- **Themes:** `window.DARK_MODES` + `window.applyDarkMode(key)` in `index.html` schalten die Theme-Variablen um. Drei Werte für `settings.darkMode`: `'dark'` (Default), `'black'` (OLED), `'light'` (creme). `applyDarkMode` setzt `--bg*`, `--ink*`, `--hair*` und `--knurl-rgb`; `light` dreht Ink dunkel und `--knurl-rgb` auf einen dunklen Wert, damit Knurl/Guilloche auf hellem Grund sichtbar bleiben. `app.jsx` ruft `applyDarkMode` bei jeder `settings.darkMode`-Änderung auf; Picker im Appearance-Sheet (Settings). Dekorative Texturen nutzen `rgba(var(--knurl-rgb), x)` statt hartcodierter heller Werte.
- **Akzentfarbe** läuft über `--accent`, `--accent-light`, `--accent-deep`, `--accent-rgb`. Keine hardcodierten `rgba(r,g,b,x)`-Werte für die Akzentfarbe, immer `rgba(var(--accent-rgb), x)`.
- Farb-Tokens im Code immer über `UI.xxx` referenzieren (z.B. `UI.gold`, `UI.ink`, `UI.hairStrong`).
- **Border-Radius-Skala** (strikte Hierarchie, nie größere Werte verwenden):
  - `4`: Inputs, kleine Buttons, Tags, Chips
  - `6`: Buttons (`Btn`-Komponente), Container, Cards (Standard)
  - `8`: große Cards/Sections (Maximum für normale UI-Elemente)
  - `999` / `50%`: Pills und kreisförmige Elemente (Dots, Avatare, Toggle-Knöpfe)
  - Ausnahme Toggle-Switch-Track: `13` (bewusst pill-förmig, 44×26px)
  - Werte wie `10`, `12`, `16` sind **nicht erlaubt**: immer auf die nächstkleinere Stufe reduzieren.
- **Gewichtseinheit:** Angezeigte Gewichts-Labels nie hart `kg`/`KG` schreiben, sondern über `UI.unit()` (gibt `'kg'`/`'lbs'`, Großschreibung via `UI.unit().toUpperCase()`). Reines Anzeige-Label aus `settings.unit`, **keine Umrechnung** (lbs-Nutzer geben lbs direkt ein). `app.jsx` spiegelt `settings.unit` bei jedem Render nach `window.__UNIT`. Interne `.kg`-Felder/`field === 'kg'` bleiben immer `kg` (Datenstruktur).
- **Typografie-Klassen** (definiert in `index.html`, nicht neu erfinden):
  - `.micro` (9px uppercase Label) · `.micro-gold` (dito, Akzentfarbe) · `.label` (10px uppercase Label) · `.num` (JetBrains Mono, für Zahlen) · `.display` (Big Shoulders Display 700, für Titel) · `.display-it` (Big Shoulders Display 900)
  - Das JS-Token `UI.fontDisplay` (`ui.jsx`) muss auf dieselbe Schrift zeigen wie die `.display`-Klassen und der Google-Fonts-`<link>` in `index.html` (aktuell „Big Shoulders Display"). Bei Schriftwechsel alle drei Stellen gemeinsam anpassen, sonst rendern JSX-Titel im Fallback.

## Konventionen

- **Supabase-Schreibzugriffe müssen Fehler propagieren.** Der JS-Client wirft bei fehlgeschlagenen Writes **nicht**, sondern löst mit `{ error }` auf (auch bei Netzwerkfehlern). Jeder Write im Sync-/Diff-Pfad läuft deshalb über `unwrap(...)` in `store.js` (wirft bei `{ error }`); nur so greift der Retry in `flushSync` (`app.jsx`) und nur so kann eine fehlgeschlagene Speicherung nicht als Erfolg durchgehen. In Screens bei direkten Supabase-Calls immer `{ error }` prüfen, bevor optimistisch UI/State aktualisiert wird.
- **CI-Gate (kein Build-Step!):** `tools/check-syntax.cjs` transpiliert alle Quellen exakt wie der In-App-Loader, `tools/test/store.test.cjs` testet die Store-Kernlogik; beide laufen via `.github/workflows/check.yml` bei jedem Push. Die JSX-Dateiliste im Check wird aus dem `SOURCES`-Array in `index.html` geparst; neue `.jsx` also wie gehabt dort eintragen, dann ist sie automatisch abgedeckt.
- **DB-Spalten:** `snake_case` (z.B. `accent_color`) · **Store-Felder:** `camelCase` (z.B. `accentColor`)
- **localStorage-Keys** (einige Settings liegen parallel im localStorage für schnellen Zugriff vor dem Store-Load; bestehende Keys konsistent halten):
  - `logbook-accent-color`, `logbook-push-enabled`, `logbook-cycle-week-view`
  - `logbook-whatsnew-seen`: zuletzt gesehene `WHATS_NEW.id`
  - `logbook-health-card-order`: Reihenfolge der Health-Tab-Karten (per Gerät, kein DB-Sync)
  - `logbook-seen-signups`: vom Admin per „Got it" abgehakte Registrierungen im Account-Tab-Feed (Array von user_ids, per Gerät)

## What's New / Changelog

- **Historie in `src/whatsnew.js`:** `window.WHATS_NEW`, ein Array von Einträgen `{ id, title, items: [...] }`, **neueste zuerst**. Leeres Array = es wird nichts angezeigt.
- **Anzeige:** Sobald die App nach einem Update `ready` ist, zeigt `WhatsNewModal` alle noch nicht gesehenen Einträge gebündelt in **einer** Karte. Tracking pro Gerät via localStorage `logbook-whatsnew-seen` (beim Schließen wird die `id` des neuesten Eintrags gespeichert). Neue Nutzer / erster Lauf ohne gespeicherte id sehen nur den neuesten Eintrag, nicht die ganze Historie.
- **Workflow: nur auf ausdrückliche Nutzeranfrage** eine Ankündigung einspielen, niemals ungefragt. Dann:
  1. Neuen Eintrag **oben** ins Array einfügen, mit neuer, eindeutiger `id` (typischerweise im Gleichschritt mit der kommenden SW-Cache-Version, z.B. `'v2.066'`).
  2. **Alte Einträge nie entfernen** (Historie für Rückkehrer).
  3. SW-Cache-Version in `sw.js` wie üblich bumpen (deployt das Update).
  4. **Texte gut schreiben, das ist der Punkt der Funktion:** klar und nutzerorientiert erklären, *was* neu ist, *welchen Nutzen* es bringt, *wie* man es benutzt. Knackige `items`, kein Tech-Jargon, keine internen Begriffe (Tabellen, Funktionsnamen). Lieber 2-4 starke Punkte als eine lange Liste.
  5. **Ton: technisch korrekt, aber light-hearted und etwas witzig.** Lockere Sprache, ein Augenzwinkern, gern ein passendes Emoji oder ein kleiner Vergleich. Die Fakten müssen trotzdem stimmen: nichts versprechen, was das Feature nicht tut, keine impliziten Falschaussagen.
- `whatsnew.js` ist plain JS (kein JSX): normales `<script>` in `index.html` (nicht über den Precompile-Loader), in `ASSETS` von `sw.js` für Offline gelistet (beides bereits eingerichtet).

## Datenbank (Supabase)

Migrationen liegen in `supabase/migrations/` als nummerierte SQL-Dateien. **Die vollständige Tabellen-/Spalten- und RPC-Referenz steht in `docs/database.md`: vor jeder DB-Arbeit den passenden Abschnitt lesen.**

**WICHTIG, Workflow bei jeder DB-Änderung** (neue Spalte, Tabelle, Funktion):
1. Migration in `supabase/migrations/` anlegen
2. Den Nutzer explizit darauf hinweisen, dass sie ausgeführt werden muss
3. `docs/database.md` aktualisieren (Tabellen/Spalten bzw. RPCs; bei neuen Tabellen auch den Kurzüberblick unten in dieser Datei)
4. `supabase/schema.sql` aktualisieren: der vollständige aktuelle Snapshot (Tabellen, RLS, Funktionen, Trigger, Realtime), muss immer mit dem Live-Schema übereinstimmen

**Bei Tabellen-Umbenennung zusätzlich:** `supabase/functions/` durchsuchen. Edge Functions greifen per REST direkt auf Tabellennamen zu (z.B. `dbFetch('zane_pushover_active?...')`), kein Compiler warnt bei falschen Namen. Alle Treffer fixen und neu deployen.

**Grant-Fallen bei neuen SECURITY-DEFINER-Funktionen** (beide real passiert, Volltext in `docs/database.md`):
- Postgres vergibt bei `CREATE FUNCTION` automatisch `EXECUTE` an `PUBLIC`, davon erbt `anon` (unabhängig von einem gezielten `REVOKE ... FROM anon`). Jede neue Funktion braucht explizit `REVOKE EXECUTE ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated` (rein interne Funktionen: kein Grant für `authenticated`).
- Nach jeder neuen Funktion prüfen (gilt für SECURITY DEFINER **und** INVOKER, siehe Migration 0141): `SELECT has_function_privilege('anon', 'public.<fn>(...)', 'execute');` muss `false` sein. (Eine `ALTER DEFAULT PRIVILEGES`-Regel gab `anon` früher zusätzlich direkte Grants; Root Cause in Migration 0132 entfernt.)

**Tabellen-Kurzüberblick** (Details je Tabelle in `docs/database.md`):
- `zane_exercises`: Übungs-Library (u.a. `log_mode`, `pull_bodyweight`, Legacy-Flags)
- `zane_schedules`: Trainingspläne inkl. Flex- und Mesozyklus-Feldern (Store-Objekt = DB-Column-Passthrough)
- `zane_sessions` + `zane_session_entries` + `zane_sets`: Trainingshistorie (relational; `sessions.entries`-JSONB ist Legacy und wird nicht mehr geschrieben)
- `zane_meso_states`: Meso-Autoregulation, eine Zeile je (User, Plan)
- `zane_workout_templates`: Workout-Vorlagen · `zane_schedule_backups`: Auto-Snapshots der Plan-Tage
- `zane_skips`: übersprungene Trainingstage · `zane_status_periods`: Sick/Vacation/Deload-Historie
- `zane_daily_logs`: Health-Tageslog (UNIQUE user_id+date, Sync via RPC) · `zane_glucose_logs`, `zane_cardio_logs`, `zane_cardio_plans`: Health/Cardio
- `zane_coaching` (+ `_threads`, `_notes`, `_macros`) und `zane_checkins`: Coaching; Sonderfälle Support-Tickets (id-Präfix `support_`) und Self-Coaching (`self_`)
- `zane_user_settings`: eine Zeile je User, alle Settings
- `zane_profiles`, `zane_app_config`, `zane_feature_grants`, `zane_push_subscriptions`, `zane_pushover_active`: Accounts, Admin-Config, Grants, Push

**Wichtige RPCs/Functions** (alle Signaturen in `docs/database.md`):
- `sync_sets_batch` / `sync_daily_logs_batch` / `sync_meso_states_batch`: Batch-Upserts mit `updated_at`-Staleness-Guard (Multi-Device-Schutz)
- `get_exercise_best_e1rm` / `get_exercise_history` / `get_session_stats`: serverseitige History-Aggregate fürs Windowing
- Admin- (Signup-Approval, All-Users, Broadcast, Force-Update, VIP), Coaching- und Support-RPCs: siehe Referenz
- Edge Function `auto-close-sessions`: schließt abgelaufene offene Sessions (Cron alle 15 min, Timeout je User via `session_timeout_minutes`)

**Realtime:** von den App-Tabellen sind nur `zane_coaching` und `zane_coaching_notes` in der `supabase_realtime`-Publikation (Live-Einladungen und -Nachrichten); die dort ebenfalls gelisteten `door_events`/`motion_events` sind app-fremd (anderes Projekt in derselben DB, ignorieren). Laufende Sessions haben keinen Realtime-Sync: der lokale Store ist die alleinige Quelle, ein Coach pollt `get_active_session_detail`.

## History-Windowing (Kurzfassung)

Der Boot lädt konstant viele Sets, unabhängig vom Account-Alter (Details und akzeptierte Degradationen: `docs/internals.md`):

- Session-**Metadaten** werden vollständig geladen, `zane_session_entries`/`zane_sets` nur für die letzten `HISTORY_WINDOW_DAYS` (70 Tage) plus die In-Progress-Session.
- Gefensterte Sessions: `entries: []` plus Aggregate `aggVolume`/`aggDoneSets`/`aggExercises`; `totalVolume()`/`doneSetCount()` fallen automatisch darauf zurück, `aggExercises > 0` unterscheidet gefenstert von echt leer. Detail-Ansichten laden Sets nach (`fetchSessionEntries`).
- PR-Erkennung: `bestE1rmForExercise` = max(Server-Aggregat `store.exerciseBests`, lokales Fenster).
- Seeds: `fetchSeedEntries` holt Server-Historie nur bei < 3 lokalen Sessions je Übung; die Session-Start-Flows awaiten das **vor** dem Anlegen der Session.
- Cache-first-Merge via `LB.mergeSessions` (unit-getestet): bestätigt Gesynctes, das der Server nicht mehr hat, wird gelöscht (Anti-Resurrection); nie Gesynctes bleibt erhalten. Gilt für Sessions, Exercises, Schedules, Skips.

## Deployment

- PWA, erreichbar unter `/training/`. Service Worker in `sw.js`.
- **SW-Cache-Version (`const CACHE = 'zane-vX.XXX'` in `sw.js`) nur auf ausdrückliche Aufforderung erhöhen.** Nicht automatisch bei jedem Commit: mit vielen aktiven Usern würde jedes kleinste Code-Update einen Update-Banner auslösen. Format `zane-vMAJOR.MINOR`, fortlaufend hochgezählt (z.B. `zane-v2.350` → `zane-v2.351`).
- **Nach einem Cache-Bump die neue Versionsnummer im Chat melden**, z.B. „SW-Cache → zane-v2.351".
