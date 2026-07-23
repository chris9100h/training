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
  - `src/screens-coaching-core.jsx`, `-client`, `-detail`, `-tabs`: Coaching-UI. **`-core` zuerst laden**: definiert die geteilten React-Aliase (`useStateC`/…) als Top-Level-`const`. Klassische Scripts teilen sich einen globalen Scope, daher diese `const` **nur in `-core`** deklarieren; alle übrigen Coaching-Symbole sind globale `function`-Deklarationen. `isImprovement`/`isDecline` sind ebenfalls geteilte Top-Level-`const`, deklariert in `screens-lib.jsx` (lädt noch vor `-core`, siehe `SOURCES`), **nicht** in `-core` selbst: eine zweite Top-Level-`const`-Deklaration desselben Namens in einer anderen Datei mit geteiltem Scope wirft beim Laden "already been declared" und reißt die komplette zweite Datei mit, das ist real passiert (Migration/Fix siehe Git-Historie um den Food-Tracker-Review). Neue geteilte `const` **grundsätzlich nur an einer einzigen Stelle** deklarieren, nie testweise an zwei. Die `window.Screens`-Registrierung steht in `-tabs`.
  - `src/store.js`: Supabase-Lesen/Schreiben, Auth-Funktionen
  - `src/supabase.js`: Supabase JS Client (vendored)
  - `src/whatsnew.js`: Changelog-Historie (`window.WHATS_NEW`, siehe „What's New / Changelog"); plain JS, normales `<script>`
  - `src/exercise-db.js`: read-only System-Übungskatalog `window.SYSTEM_EXERCISES`; plain JS, normales `<script>`, in `ASSETS`. Merkregel: Pläne/Sessions halten **nie** `sys_`-Ids, beim Übernehmen/Picken entsteht immer eine editierbare User-Kopie in `store.exercises` (Details: `docs/internals.md`).
  - `src/feature-map-db.js`: versionierter Master-Katalog der Feature-Map `window.FEATURE_MAP` (Kategorien + Karten mit stabiler `id`); plain JS, normales `<script>`, in `ASSETS`. Das ist die Pflege-Quelle zum Aktuell-Halten: neue Features hier als Karte ergänzen/editieren. `src/screens-featuremap.jsx` (`FeatureMapScreen`) rendert ihn und legt die Admin-Kuratierung aus `zane_feature_map` als Vorschau darüber; die Public-Seite rendert ihn direkt (kein Login, keine DB).
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
- **Neue Settings** müssen immer an vier Stellen in `store.js` ergänzt werden:
  1. `loadFromSupabase`: Mapping DB → Store
  2. `settingsChanged`-Check in `syncStore`
  3. `upsert`-Objekt in `syncStore`
  4. `settingsRow` in `importFromBackup` (sonst geht die Einstellung beim Restore verloren)
  Das CI-Gate `tools/check-backup-coverage.cjs` erzwingt Punkt 4 (und die Backup-Abdeckung aller Tabellen) automatisch.

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
- **CI-Gate (kein Build-Step!):** `tools/check-syntax.cjs` transpiliert alle Quellen exakt wie der In-App-Loader, `tools/test/store.test.cjs` testet die Store-Kernlogik, `tools/check-db-docs.cjs` prüft Migrationen gegen `schema.sql`/`docs/database.md`, `tools/check-backup-coverage.cjs` fährt export→import im Sandbox und stellt sicher, dass ein Backup jede Schema-Spalte round-trippt (schlägt fehl mit fertigem Fix-Prompt); alle vier laufen via `.github/workflows/check.yml` bei jedem Push. Die JSX-Dateiliste im Check wird aus dem `SOURCES`-Array in `index.html` geparst; neue `.jsx` also wie gehabt dort eintragen, dann ist sie automatisch abgedeckt. Zusätzlich vergleicht `tools/check-db-live.cjs` (`db-drift.yml`, wöchentlich) die echte DB gegen Snapshot und Doku. **Postet der Nutzer einen fehlgeschlagenen Drift-Lauf, sofort nach dem Playbook in `docs/database.md` („Drift-Checks") bereinigen.**
- **DB-Spalten:** `snake_case` (z.B. `accent_color`) · **Store-Felder:** `camelCase` (z.B. `accentColor`)
- **localStorage-Keys** (einige Settings liegen parallel im localStorage für schnellen Zugriff vor dem Store-Load; bestehende Keys konsistent halten):
  - `logbook-accent-color`, `logbook-push-enabled`, `logbook-cycle-week-view`
  - `logbook-whatsnew-seen`: zuletzt gesehene `WHATS_NEW.id`
  - `logbook-health-card-order`: Reihenfolge der Health-Tab-Karten (per Gerät, kein DB-Sync)
  - `logbook-seen-signups`: vom Admin per „Got it" abgehakte Registrierungen im Account-Tab-Feed (Array von user_ids, per Gerät)
  - `logbook-fever-nudge-declined-date`: Datum der letzten Ablehnung des „Als Sick markieren?"-Prompts nach einer Fieber-Temperaturmessung, verhindert wiederholtes Nachfragen am selben Tag (per Gerät)
  - `logbook-paper-accent-enabled`: Opt-out aus Papers Grau-Muting der Akzentfarbe (`applyAccentColor`, `index.html`), Default aus, Toggle in Settings → Appearance (nur sichtbar wenn Paper aktiv), per Gerät
  - `logbook-pending-share`: gestashter Token eines geöffneten Rezept-Share-Links (`?share=<token>`, `app.jsx`), überlebt so den Login-/Signup-Roundtrip; gelöscht sobald das `RecipeShareSheet` geschlossen wird

## What's New / Changelog

- **Historie in `src/whatsnew.js`:** `window.WHATS_NEW`, ein Array von Einträgen `{ id, date, title, items: [...] }`, **neueste zuerst** (`date` im Format `YYYY-MM-DD`). Leeres Array = es wird nichts angezeigt.
- **Anzeige:** Sobald die App nach einem Update `ready` ist, zeigt `WhatsNewModal` alle noch nicht gesehenen Einträge gebündelt in **einer** Karte. Tracking pro Gerät via localStorage `logbook-whatsnew-seen` (beim Schließen wird die `id` des neuesten Eintrags gespeichert). Neue Nutzer / erster Lauf ohne gespeicherte id sehen nur den neuesten Eintrag, nicht die ganze Historie.
- **Workflow: nur auf ausdrückliche Nutzeranfrage** eine Ankündigung einspielen, niemals ungefragt. Dann:
  1. **Erst Entwurf im Chat zeigen, auf Freigabe warten.** Noch nicht in `whatsnew.js` schreiben (oder falls als Zwischenschritt schon geschrieben: nicht committen/pushen/bumpen). Titel + Items als Text posten, erst nach OK des Nutzers weitermachen.
  2. Neuen Eintrag **oben** ins Array einfügen, mit neuer, eindeutiger `id` (typischerweise im Gleichschritt mit der kommenden SW-Cache-Version, z.B. `'v2.066'`) und einem **`date`** (Publikationstag, Format `YYYY-MM-DD`). Das `date`-Feld ist ab sofort Pflicht: jeder Eintrag trägt es.
  3. **Alte Einträge nie entfernen** (Historie für Rückkehrer).
  4. SW-Cache-Version in `sw.js` wie üblich bumpen (deployt das Update).
  5. **Texte gut schreiben, das ist der Punkt der Funktion:** klar und nutzerorientiert erklären, *was* neu ist, *welchen Nutzen* es bringt, *wie* man es benutzt. Knackige `items`, kein Tech-Jargon, keine internen Begriffe (Tabellen, Funktionsnamen). Lieber 2-4 starke Punkte als eine lange Liste.
  6. **Ton: technisch korrekt, aber light-hearted und etwas witzig.** Lockere Sprache, ein Augenzwinkern, gern ein passendes Emoji oder ein kleiner Vergleich. Die Fakten müssen trotzdem stimmen: nichts versprechen, was das Feature nicht tut, keine impliziten Falschaussagen.
- `whatsnew.js` ist plain JS (kein JSX): normales `<script>` in `index.html` (nicht über den Precompile-Loader), in `ASSETS` von `sw.js` für Offline gelistet (beides bereits eingerichtet).

## Feature Map

Nutzer-/Coach-orientierte Übersicht aller App-Fähigkeiten. Architektur: **Code-Katalog als Basis** plus zwei DB-Ebenen (Draft + Published). Jeder sieht: Katalog (Basis) + veröffentlichte Overrides.

- **Master-Katalog = `src/feature-map-db.js`** (`window.FEATURE_MAP = { version, categories, cards }`), plain JS. Basis-Ebene und Offline-Fallback. Kategorien in Anzeige-Reihenfolge; Karten-Shape `{ id, cat, role, name, summary, actions: [...], hidden? }`.
  - `id`: stabiler Slug (z.B. `logging.rest-timer`). **Nie umbenennen oder wiederverwenden**, die Ids keyen die Override-Tabellen.
  - `role`: `'user' | 'coach' | 'both'`. `cat`: eine Kategorie-`id`.
  - `version` bei inhaltlichen Änderungen mitziehen (Format wie `'v2 (2026-07-10)'`).
- **Zwei DB-Ebenen** (beide spaltenidentisch, admin-only RLS, nicht im Backup):
  - `zane_feature_map` = **Draft**: privater Arbeitsstand des Admins (ausblenden/editieren/hinzufügen/umsortieren als Overrides über dem Katalog, Live-Vorschau).
  - `zane_feature_map_published` = **Published**: die Ebene, die alle sehen.
- **Wer rendert was** (beide filtern `hidden: true` **vor** dem Render, kein DOM-Leak):
  - In-App: `src/screens-featuremap.jsx` (`FeatureMapScreen`, Route `featuremap`, Button im Settings-Footer) für **alle** User. Admin sieht seinen **Draft** (liest Draft + Published direkt für den Diff); normale User sehen **Published** über die RPC `get_public_feature_map`.
  - Public: `features.html` (Repo-Root, `zane-wo.com/features.html`), **kein Login**. Holt Published per `get_public_feature_map` und legt es über den gebündelten Katalog; Fallback auf den Katalog bei Fehler/offline.
- **Neues Feature aufnehmen (Code-Weg):** Karte in `src/feature-map-db.js` ergänzen/editieren, deploybar wie normaler Code. Erscheint automatisch für alle (Basis-Ebene). Nur End-User/Coach-relevantes, kein Tech-Jargon.
- **Kuratieren + veröffentlichen (In-App, der Live-Weg):** Der Admin editiert den Draft in-app. „X unpublished changes" öffnet ein Review-Sheet: einzeln verwerfen, alle verwerfen (`discard_feature_map`, Draft ← Published), oder **Publish** (`publish_feature_map`, Published ← Draft). Publish ist **live für alle ohne Deploy** (Content kommt zur Laufzeit aus der DB), **kein Cache-Bump nötig**.
- **Baken (Housekeeping, selten):** Die manuelle GitHub-Action `.github/workflows/bake-feature-map.yml` (→ `tools/bake-feature-map.cjs`) faltet die Published-Ebene zurück in `src/feature-map-db.js`, bumpt den SW-Cache, pusht direkt und leert danach beide Tabellen. Läuft **nur bei sauberem Stand** (Draft == Published), sonst Abbruch. Braucht `SUPABASE_SERVICE_ROLE_KEY` (GitHub-Secret). Manuell via Actions-Tab starten, keine Automatik. `feature-map-db.js` ist ab da eine **generierte Datei** (Serializer), Handedits bleiben möglich.
- **RPCs** (Migration 0156, Grant-Details in `docs/database.md`): `publish_feature_map` / `discard_feature_map` (admin-only) · `get_public_feature_map` (an `anon` **und** `authenticated`, einzige Feature-Map-Funktion mit anon-Zugriff).
- **Loader/Assets:** `feature-map-db.js` als `<script>` in `index.html`, in `ASSETS` (`sw.js`), in `plainSources` (`tools/check-syntax.cjs`). `screens-featuremap.jsx` in `SOURCES` (index.html) + `ASSETS`. `features.html` bewusst **nicht** in `ASSETS`.
- **Cache-Bump-Regel:** Reine In-App-Publishes = **kein** Bump (live über DB). Screen-/Katalog-Code-Änderungen = Bump wie überall (nur auf Ansage); den Bake-Bump macht der Workflow selbst.
- **`features.html`-Cache-Buster:** Die Public-Seite liegt außerhalb des Service Workers und hat keine SW-Cache-Version, die ein Refetch erzwingt. Sie lädt den Katalog per `<script src="src/feature-map-db.js?v=X">`. Bei jeder Katalog-Änderung (also immer wenn der SW-Cache gebumpt wird) diesen `?v=` im Gleichschritt mit der SW-Cache-Version hochziehen, sonst serviert der Browser der Public-Seite trotz frischem Deploy die alte `feature-map-db.js` weiter (die App merkt es nicht, weil ihr SW-Cache-Bump den Katalog ohnehin neu holt).

## Public-Seiten (außerhalb des Service Workers)

Standalone-HTML im Repo-Root, kein Login, kein Loader, **nicht** in `sw.js`-`ASSETS`. Jede hat einen eigenen `?v=`-Cache-Buster, der bei jedem Deploy **im Gleichschritt mit der SW-Cache-Version** hochgezogen werden muss (gleiche Begründung wie beim `features.html`-Buster oben):

- **`features.html`** (`zane-wo.com/features.html`): Feature-Map-Übersicht. Lädt `src/feature-map-db.js?v=X` (Content zusätzlich live aus der DB per `get_public_feature_map`).
- **`autoreg.html`** (`zane-wo.com/autoreg.html`): Autoregulation-/Mesocycle-Guide, Startseite = 3 Mode-Cards, Auswahl reshaped die Seite. Lädt `src/autoreg-guide-page.js?v=X`. Diese JS-Datei ist der Content+Render der Public-Seite (spiegelt `src/screens-autoreg-guide.jsx` inhaltlich), wird **nur** von `autoreg.html` genutzt (die App hat den JSX-Screen), daher nicht in `ASSETS`/Loader. Bei inhaltlichen Guide-Änderungen also beide Stellen (JSX-Screen **und** `autoreg-guide-page.js`) nachziehen.

## Datenbank (Supabase)

Migrationen liegen in `supabase/migrations/` als nummerierte SQL-Dateien. **Die vollständige Tabellen-/Spalten- und RPC-Referenz steht in `docs/database.md`: vor jeder DB-Arbeit den passenden Abschnitt lesen.**

**WICHTIG, Workflow bei jeder DB-Änderung** (neue Spalte, Tabelle, Funktion):
1. Migration in `supabase/migrations/` anlegen
2. Den Nutzer explizit darauf hinweisen, dass sie ausgeführt werden muss
3. `docs/database.md` aktualisieren (Tabellen/Spalten bzw. RPCs; bei neuen Tabellen auch den Kurzüberblick unten in dieser Datei)
4. `supabase/schema.sql` aktualisieren: der vollständige aktuelle Snapshot (Tabellen, RLS, Funktionen, Trigger, Realtime), muss immer mit dem Live-Schema übereinstimmen
5. **Gehört die neue Spalte/Tabelle in ein User-Backup?** Dann Export (`loadFromSupabase`) **und** Import (`importFromBackup`) in `store.js` nachziehen, sonst geht sie beim Restore verloren. Das CI-Gate `tools/check-backup-coverage.cjs` erzwingt das: fehlt eine Spalte, schlägt es fehl und druckt einen fertigen Fix-Prompt. Ist die Spalte/Tabelle bewusst **nicht** im Backup (Admin/Device/Coaching), im Tool auf die Allowlist bzw. `EXCLUDED` setzen (mit Begründung).

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
- `zane_plan_drafts`: In-Progress-Draft des Plan-Editors für Multi-Device-Autosave (eine Zeile je User+Plan, bewusst entkoppelt von `zane_schedules`, LWW über `updated_at`, bei Save/Discard gelöscht, nicht im Backup)
- `zane_skips`: übersprungene Trainingstage · `zane_status_periods`: Sick/Vacation/Deload-Historie
- `zane_daily_logs`: Health-Tageslog (UNIQUE user_id+date, Sync via RPC) · `zane_glucose_logs`, `zane_blood_pressure_logs`, `zane_body_temp_logs`, `zane_cardio_logs`, `zane_cardio_plans`: Health/Cardio
- `zane_water_logs`: Per-Entry-Wasserlog des Water-Trackers (`WaterScreen`); Tagessumme wird zurück in `zane_daily_logs.water_ml` gespiegelt; Store-Collection wie Cardio-Logs. Migration 0180. Vergangene Tage werden stündlich per Cron zu einer Zeile zusammengefasst (`breakdown`-jsonb hält die Getränke-Aufschlüsselung), Migration 0183
- `zane_foods`: geteilter/globaler Referenz-Cache (Open Food Facts/USDA, **keine** Per-User-Daten), befüllt nur bei Auswahl eines Suchtreffers · `zane_food_logs`: Per-Entry-Food-Log des Macro-Trackers (`FoodScreen`), zum Schreibzeitpunkt denormalisiert, Tagessumme gespiegelt in `zane_daily_logs.protein`/`carbs`/`fat`/`calories`/`fiber`; Store-Collection wie `zane_water_logs`. Migration 0186 · `zane_food_favorites`/`zane_food_recipes`: Food-Tracker-"Quick Add" (User-Favoriten bzw. benannte Zutaten-Listen als jsonb-Snapshot), eigene simple User-Collections wie `zane_workout_templates`, kein Coach-Zugriff. Migration 0187 · `zane_recipe_shares`: Rezept-Share-Links (Token → jsonb-Snapshot, Deep-Link `?share=<token>`), RLS ohne Policies, Zugriff nur über die RPCs `create_recipe_share`/`get_recipe_share` (authenticated-only), kein Store-Field, nicht im Backup. Migration 0193
- `zane_coaching` (+ `_threads`, `_notes`, `_macros`) und `zane_checkins`: Coaching; Sonderfälle Support-Tickets (id-Präfix `support_`) und Self-Coaching (`self_`) · `zane_checkin_schema_templates`: bis zu 5 gespeicherte Check-in-Schema-Vorlagen je Coach
- `zane_user_settings`: eine Zeile je User, alle Settings
- `zane_profiles`, `zane_app_config`, `zane_feature_grants`, `zane_push_subscriptions`, `zane_pushover_active`: Accounts, Admin-Config, Grants, Push
- `zane_feature_map`: Admin-Override-Ebene der Feature-Map (`FeatureMapScreen`); Master-Inhalt liegt versioniert in `src/feature-map-db.js` (`window.FEATURE_MAP`), diese Tabelle hält nur Admin-Kuratierung (hide/edit/add/sort), admin-only RLS; nicht im Backup

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
