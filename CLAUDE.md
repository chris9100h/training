# Logbook: Projektkontext für Claude

## Sprache

- **Konversation mit dem Nutzer:** Deutsch
- **App-UI, Code, Commits, Kommentare:** Englisch
- **Keine Em-Dashes (—). Niemals.** Der Nutzer hasst sie. In keinem Output verwenden: nicht in Chat-Antworten, App-Texten, Code-Kommentaren, Commits, What's-New oder Doku. Stattdessen Komma, Doppelpunkt, Klammern, oder den Satz mit Punkt aufteilen.

## Referenzdoku (bei Bedarf lesen, nicht raten)

Diese Datei enthält die verbindlichen Regeln und den Überblick; sie bewusst schlank halten. Detailwissen gehört in `docs/`:

- **`docs/database.md`**: vollständige Tabellen-/Spalten-Referenz, alle RPCs, RLS-Notizen, Realtime. Die Spalten-Doku enthält die Verhaltens-Contracts der App. **Vor jeder Arbeit an Migrationen, `store.js`-Sync oder Features mit DB-Berührung den passenden Abschnitt lesen.**
- **`docs/internals.md`**: Deep-Dives zu Precompile-Loader, System-Übungskatalog (`exercise-db.js`), Plan-Setup-Wizard, History-Windowing/Boot-Merge, 5/3/1, Time-based/Assisted Exercises, plus die Verhaltens-Contracts aller localStorage-Keys. Vor Änderungen an diesen Bereichen lesen.

## Architektur

- **Source fallback plus build output.** Der Repo-Root bleibt als No-Build-Fallback nutzbar; `npm run build` erzeugt für Cloudflare Preview eine vorab kompilierte `dist/`-Ausgabe mit Core-, Critical- und Lazy-Modul-Chunks. Die Laufzeit-Abhängigkeiten bleiben über CDN-Scripts in `index.html` (React 18 Production-Build, Babel Standalone-Fallback, Supabase JS).
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
  - `src/screens-health.jsx`: Health-Tab (Daily Log: Gewicht/Makros/Steps/Wasser, Glucose, Adherence) · `src/screens-water.jsx`: Water-Tracker · `src/screens-food.jsx`: Food-Tracker · `src/screens-medications.jsx`: Medications
  - `src/screens-cardio.jsx`: Cardio · `src/screens-onboarding.jsx`: Welcome-Tour · `src/screens-featuremap.jsx`: Feature-Map-Screen · `src/screens-autoreg-guide.jsx`: Autoregulation-Guide
  - `src/screens-coaching-core.jsx`, `-client`, `-detail`, `-tabs`: Coaching-UI. **`-core` zuerst laden**: definiert die geteilten React-Aliase (`useStateC`/…) als Top-Level-`const`. Klassische Scripts teilen sich einen globalen Scope: eine zweite Top-Level-`const` desselben Namens in einer anderen Datei wirft beim Laden "already been declared" und reißt die komplette zweite Datei mit (real passiert, Fix siehe Git-Historie um den Food-Tracker-Review). Geteilte `const` deshalb **nur an genau einer Stelle** deklarieren, nie testweise an zwei; `isImprovement`/`isDecline` liegen in `screens-lib.jsx` (lädt vor `-core`, siehe `SOURCES`), alle übrigen Coaching-Symbole sind globale `function`-Deklarationen. Die `window.Screens`-Registrierung steht in `-tabs`.
  - `src/store.js`: Supabase-Lesen/Schreiben, Auth-Funktionen
  - `src/supabase.js`: Supabase JS Client (vendored)
  - `src/whatsnew.js`: Changelog-Historie (`window.WHATS_NEW`, siehe „What's New / Changelog"); plain JS, normales `<script>`
  - `src/exercise-db.js`: read-only System-Übungskatalog `window.SYSTEM_EXERCISES`; plain JS, normales `<script>`, in `ASSETS`. Merkregel: Pläne/Sessions halten **nie** `sys_`-Ids, beim Übernehmen/Picken entsteht immer eine editierbare User-Kopie in `store.exercises` (Details: `docs/internals.md`).
  - `src/feature-map-db.js`: versionierter Master-Katalog der Feature-Map `window.FEATURE_MAP`; plain JS, normales `<script>`, in `ASSETS`. Pflege-Quelle zum Aktuell-Halten: neue Features hier als Karte ergänzen (siehe „Feature Map").
  - `supabase/`: Migrationen, Edge Functions, Schema. **`supabase/functions/_shared/`** hält den geteilten Edge-Function-Code: `edge.ts` (CORS, JSON-Response, `resolveUser`, `withinQuota`) und `ai.ts` (Anbieter-Tabelle Claude/Grok/Qwen plus Antwort-Helfer). Ordner mit `_`-Präfix werden **nicht** als eigene Function deployed, die CLI bündelt sie in jeden Importeur: eine Änderung dort wird erst wirksam, wenn **alle Importeure neu deployed** werden. Aktuell importieren `parse-meal`, `scan-label`, `ai-daily-summary` und `ai-checkin-opinion`; die übrigen Functions tragen bewusst eigene Kopien von `resolveUser`/`withinQuota` weiter (eine Migration hieße Deploy ohne Verhaltensgewinn) und ziehen einzeln nach, wenn sie ohnehin mal angefasst werden.

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
- **Themes:** `window.DARK_MODES` + `window.applyDarkMode(key)` in `index.html`. Vier Werte für `settings.darkMode`: `'dark'` (Default), `'black'` (OLED), `'light'` (creme), `'paper'` (Papier-Look, Opt-out-Key `logbook-paper-accent-enabled`). `applyDarkMode` setzt `--bg*`, `--ink*`, `--hair*` und `--knurl-rgb`; `light` dreht Ink dunkel und `--knurl-rgb` auf einen dunklen Wert, damit Knurl/Guilloche sichtbar bleiben. `app.jsx` ruft es bei jeder `settings.darkMode`-Änderung; Picker im Appearance-Sheet. Dekorative Texturen nutzen `rgba(var(--knurl-rgb), x)` statt hartcodierter heller Werte.
- **Akzentfarbe** läuft über `--accent`, `--accent-light`, `--accent-deep`, `--accent-rgb`. Keine hardcodierten `rgba(r,g,b,x)`-Werte für die Akzentfarbe, immer `rgba(var(--accent-rgb), x)`.
- Farb-Tokens im Code immer über `UI.xxx` referenzieren (z.B. `UI.gold`, `UI.ink`, `UI.hairStrong`).
- **Border-Radius-Skala** (strikte Hierarchie, nie größere Werte verwenden):
  - `2`: **Micro-Badges**, also nicht-interaktive Label mit 9px Schrift oder kleiner (`TierChip`, MESO-/DELOAD-/BONUS-Badges, Feature-Map-Rolle, Check-in-Feldtypen). Auf der Höhe frisst ein 4er-Radius die halbe Kante und wirkt wie eine Pille. Die Grenze ist **interaktiv oder nicht**: alles Antippbare (auch 9px-Buttons und Options-Chips, ebenso Onboarding-Mockups echter Buttons) bleibt auf `4`.
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
- **CI-Gates** (kein Build-Step; alle acht laufen via `.github/workflows/check.yml` bei jedem Push): `tools/check-syntax.cjs` (transpiliert alle Quellen exakt wie der In-App-Loader; die JSX-Liste wird aus `SOURCES` in `index.html` geparst, neue Dateien sind damit automatisch abgedeckt), `tools/test/store.test.cjs` (Store-Kernlogik), `tools/check-db-docs.cjs` (Migrationen vs. `schema.sql`/`docs/database.md`), `tools/check-backup-coverage.cjs` (export→import-Sandbox, jede Schema-Spalte muss round-trippen, druckt bei Fehlern einen fertigen Fix-Prompt), `tools/check-cache-version.cjs` (`?v=`-Buster der Public-Seiten vs. SW-Cache-Version), `tools/check-asset-parity.cjs` (alles, was `index.html` lädt, muss in `ASSETS` des SW stehen; Public-Seiten bleiben draußen), `tools/check-sw.cjs` (führt `sw.js` in einer Node-VM aus: Branch-Routing, Offline-Fallbacks, waitUntil-Abdeckung), `tools/check-emdash.cjs` (einzige Ausnahme: die alleinstehende Platzhalter-Glyphe). Wöchentlich vergleicht zusätzlich `tools/check-db-live.cjs` (`db-drift.yml`) die echte DB gegen Snapshot und Doku. **Postet der Nutzer einen fehlgeschlagenen Drift-Lauf, sofort nach dem Playbook in `docs/database.md` („Drift-Checks") bereinigen.**
- **DB-Spalten:** `snake_case` (z.B. `accent_color`) · **Store-Felder:** `camelCase` (z.B. `accentColor`)
- **localStorage-Keys** (einige Settings liegen parallel im localStorage für schnellen Zugriff vor dem Store-Load; bestehende Keys konsistent halten. Verhaltens-Contracts je Key: `docs/internals.md`, Abschnitt „localStorage-Keys"):
  - `logbook-accent-color` / `logbook-push-enabled` / `logbook-cycle-week-view` (Settings-Spiegel) · `logbook-whatsnew-seen` (zuletzt gesehene `WHATS_NEW.id`) · `logbook-health-card-order` · `logbook-seen-signups` (Admin-Feed-Dismiss)
  - `logbook-fever-nudge-declined-date` (Sick-Prompt-Ablehnung, max. 1x/Tag nachfragen) · `logbook-paper-accent-enabled` (Opt-out Paper-Grau-Muting) · `logbook-pending-share` (Rezept-Share-Token, überlebt Login-Roundtrip)
  - `logbook-food-fav-cache-attempt` / `-repaired` (Favoriten-Cache-Reparatur: Fehlschlag-Datum bzw. erledigte foodIds, verhindern Quota-fressende Retry-Loops) · `logbook-shopping-list-days` (Einkaufs-Horizont, Default 7) · `logbook-low-stock-acked` / `logbook-med-low-stock-acked` (weggetippte Running-Low-Banner, an `stock_set_at` gekeyt) · `logbook-cooking-draft` (In-Progress-Cooking-Mode, nur ein aktiver Cook, überlebt App-Kill) · `logbook-fasting-state` (Intermittent-Fasting-Zyklus-Zustand, per Gerät)
  - Der Label-Scan (`scan-label`) und „Describe a meal" (`parse-meal`) haben **kein** Provider-Toggle mehr: Qwen läuft als Primary (Kostenvorteil), mit serverseitigem Automatik-Fallback auf den langjährigen Default (Grok fürs Scannen, Claude fürs Parsen). Details: `docs/database.md`, Abschnitte „Label-Scanner" und „Describe a meal".
  - Shopping-List-Overrides (Name/Exclude/Packungsgröße) sind seit Migration 0215 **nicht** mehr localStorage, sondern geräteübergreifend in `zane_food_shopping_prefs`.

## What's New / Changelog

- **Historie in `src/whatsnew.js`:** `window.WHATS_NEW`, Array von `{ id, date, title, items: [...] }`, **neueste zuerst** (`date` = Publikationstag, Format `YYYY-MM-DD`, Pflichtfeld). Leeres Array = nichts wird angezeigt.
- **Anzeige:** Nach einem Update zeigt `WhatsNewModal` alle noch nicht gesehenen Einträge gebündelt in **einer** Karte; Tracking pro Gerät via `logbook-whatsnew-seen`.
- **Workflow: nur auf ausdrückliche Nutzeranfrage** eine Ankündigung einspielen, niemals ungefragt. Dann:
  1. **Erst Entwurf im Chat zeigen (Titel + Items als Text), auf Freigabe warten.** Noch nicht in `whatsnew.js` schreiben; falls als Zwischenschritt schon geschrieben, nicht committen/pushen/bumpen.
  2. Neuen Eintrag **oben** einfügen, mit neuer eindeutiger `id` (typischerweise im Gleichschritt mit der kommenden SW-Cache-Version, z.B. `'v2.066'`) und `date`.
  3. **Alte Einträge nie entfernen** (Historie für Rückkehrer).
  4. SW-Cache-Version in `sw.js` wie üblich bumpen (deployt das Update).
  5. **Texte gut schreiben, das ist der Punkt der Funktion:** klar und nutzerorientiert (*was* ist neu, *welcher Nutzen*, *wie* benutzen). Kein Tech-Jargon, keine internen Begriffe. Lieber 2-4 starke Punkte als eine lange Liste.
  6. **Ton: technisch korrekt, aber light-hearted und etwas witzig.** Gern ein Emoji oder kleiner Vergleich. Die Fakten müssen stimmen: nichts versprechen, was das Feature nicht tut.
- `whatsnew.js` ist plain JS (kein JSX): normales `<script>` in `index.html`, in `ASSETS` von `sw.js` (beides eingerichtet).

## Feature Map

Nutzer-/Coach-orientierte Übersicht aller App-Fähigkeiten. **Code-Katalog als Basis** (`src/feature-map-db.js`, `window.FEATURE_MAP = { version, categories, cards }`) plus zwei spaltenidentische DB-Ebenen (admin-only RLS, nicht im Backup): `zane_feature_map` = **Draft** des Admins, `zane_feature_map_published` = **Published** (sehen alle). Jeder sieht Katalog + veröffentlichte Overrides.

- Kategorien in Anzeige-Reihenfolge; Karten-Shape `{ id, cat, role: 'user'|'coach'|'both', name, summary, actions: [...], hidden? }`. `id` ist ein stabiler Slug (z.B. `logging.rest-timer`): **nie umbenennen oder wiederverwenden**, die Ids keyen die Override-Tabellen. `version` bei inhaltlichen Änderungen mitziehen (Format `'v2 (2026-07-10)'`).
- **Neues Feature aufnehmen (Code-Weg):** Karte in `feature-map-db.js` ergänzen/editieren, erscheint automatisch für alle. Nur End-User/Coach-Relevantes, kein Tech-Jargon.
- **Rendering:** In-App `FeatureMapScreen` (Route `featuremap`, Button im Settings-Footer): Admin sieht seinen Draft, normale User Published via RPC `get_public_feature_map` (einzige Feature-Map-RPC mit anon-Zugriff; Grant-Details `docs/database.md`). Public: `features.html`, Fallback auf den Katalog bei Fehler/offline. Beide filtern `hidden: true` **vor** dem Render (kein DOM-Leak).
- **Kuratieren + Publish (in-app, der Live-Weg):** Admin editiert den Draft; „X unpublished changes" öffnet ein Review-Sheet (einzeln/alle verwerfen via `discard_feature_map`, oder **Publish** via `publish_feature_map`). Publish ist **live für alle ohne Deploy** und braucht **keinen Cache-Bump** (Content kommt zur Laufzeit aus der DB). Screen-/Katalog-Code-Änderungen = Bump wie überall (nur auf Ansage).
- **Baken (Housekeeping, selten):** manuelle GitHub-Action `bake-feature-map.yml` (→ `tools/bake-feature-map.cjs`) faltet Published zurück in `feature-map-db.js`, bumpt selbst, pusht und leert beide Tabellen; läuft nur bei Draft == Published, braucht `SUPABASE_SERVICE_ROLE_KEY`. `feature-map-db.js` ist ab da generiert, Handedits bleiben möglich.
- **Registrierung:** `feature-map-db.js` als `<script>` in `index.html` + `ASSETS` (`sw.js`) + `plainSources` (`tools/check-syntax.cjs`); `screens-featuremap.jsx` in `SOURCES` + `ASSETS`; `features.html` bewusst **nicht** in `ASSETS`.

## Public-Seiten (außerhalb des Service Workers)

Standalone-HTML im Repo-Root (`zane-wo.com/…`), kein Login, kein Loader, **nicht** in `sw.js`-`ASSETS` (auch neue Seiten nie dort eintragen). Jede lädt ihre JS-Quelle mit eigenem `?v=`-Cache-Buster, der bei jedem Deploy **im Gleichschritt mit der SW-Cache-Version** hochgezogen werden muss: außerhalb des SW erzwingt sonst nichts einen Refetch, der Browser serviert trotz frischem Deploy alte Dateien weiter (`check-cache-version.cjs` erzwingt den Gleichschritt).

- **`welcome.html`**: Marketing-Landingpage, Einstiegspunkt für geteilte Links, einzige Seite mit **Open-Graph-/Twitter-Meta-Tags** (`index.html` hat keine, ein geteilter App-Link rendert deshalb als nackte URL). Lädt `feature-map-db.js?v=X` für die Live-Zähler im Hero (Anzahl Features/Kategorien direkt aus dem Katalog, damit keine Marketing-Zahl veraltet) und holt per anon-RPC `get_founding_seats` (roher `fetch`) den Live-Stand der Founding-Plätze: bei Fehler bleibt der Zähler ausgeblendet, der DB-Gesamtwert überschreibt auch die `75` in Headline und Fließtext. Liegt bewusst **nicht** auf `/`: dort ist die App (SW cacht `/` als App-Shell, `manifest.start_url` zeigt darauf), ein Umzug würde Homescreen-Installs auf die Marketingseite schicken und bräuchte einen `display-mode: standalone`-Redirect plus SW-Scope-Anpassung, nur nach bewusster Entscheidung. Screenshot-Slots (`screenshots/*.png`, Liste in `screenshots/README.md`) sind optional: jedes `<img>` entfernt sich per `onerror` selbst, neue Screenshots brauchen keine Markup-Änderung, nur die Datei am erwarteten Pfad.
- **`features.html`**: Feature-Map-Übersicht (gebündelter Katalog + live Published per `get_public_feature_map`).
- **`autoreg.html`**: Autoregulation-/Mesocycle-Guide (Start = 3 Mode-Cards). Lädt `src/autoreg-guide-page.js?v=X`; diese Datei spiegelt den JSX-Screen `screens-autoreg-guide.jsx` inhaltlich und wird nur von dieser Seite genutzt (daher nicht in `ASSETS`/Loader). Bei Guide-Änderungen **beide** Stellen nachziehen.

Die drei Seiten sind untereinander verlinkt (Footer-Links, Wordmark/Eyebrow zurück auf `welcome.html`); beim Editieren erhalten, damit ein Deep-Link den Rest der Site erreicht.

## Datenbank (Supabase)

Migrationen liegen in `supabase/migrations/` als nummerierte SQL-Dateien. **Die vollständige Tabellen-/Spalten- und RPC-Referenz steht in `docs/database.md`: vor jeder DB-Arbeit den passenden Abschnitt lesen.**

**WICHTIG, Workflow bei jeder DB-Änderung** (neue Spalte, Tabelle, Funktion):
1. Migration in `supabase/migrations/` anlegen
2. Den Nutzer explizit darauf hinweisen, dass sie ausgeführt werden muss
3. `docs/database.md` aktualisieren (Tabellen/Spalten bzw. RPCs; bei neuen Tabellen auch den Kurzüberblick unten in dieser Datei)
4. `supabase/schema.sql` aktualisieren: der vollständige aktuelle Snapshot (Tabellen, RLS, Funktionen, Trigger, Realtime), muss immer mit dem Live-Schema übereinstimmen
5. **Gehört die neue Spalte/Tabelle in ein User-Backup?** Dann Export (`loadFromSupabase`) **und** Import (`importFromBackup`) in `store.js` nachziehen, sonst geht sie beim Restore verloren. Das CI-Gate `tools/check-backup-coverage.cjs` erzwingt das und druckt bei Fehlern einen fertigen Fix-Prompt. Ist die Spalte/Tabelle bewusst **nicht** im Backup (Admin/Device/Coaching), im Tool auf die Allowlist bzw. `EXCLUDED` setzen (mit Begründung).

**Bei Tabellen-Umbenennung zusätzlich:** `supabase/functions/` durchsuchen. Edge Functions greifen per REST direkt auf Tabellennamen zu (z.B. `dbFetch('zane_pushover_active?...')`), kein Compiler warnt bei falschen Namen. Alle Treffer fixen und neu deployen.

**Grant-Fallen bei neuen SECURITY-DEFINER-Funktionen** (real passiert, Volltext und Beispiele in `docs/database.md`, „Grant-Fallen"):
- Postgres vergibt bei `CREATE FUNCTION` automatisch `EXECUTE` an `PUBLIC`, davon erbt `anon`. Jede neue Funktion braucht explizit `REVOKE EXECUTE ... FROM PUBLIC` + `GRANT EXECUTE ... TO authenticated` (rein interne Funktionen: kein Grant für `authenticated`).
- Nach jeder neuen Funktion (SECURITY DEFINER **und** INVOKER) prüfen: `SELECT has_function_privilege('anon', 'public.<fn>(...)', 'execute');` muss `false` sein. Bei service-role-only Funktionen zusätzlich dieselbe Abfrage für `authenticated`.
- Service-role-only Funktionen (z.B. `bump_api_usage`) brauchen **zusätzlich** explizit `REVOKE EXECUTE ... FROM authenticated`: eine `ALTER DEFAULT PRIVILEGES`-Regel vergibt `EXECUTE` weiterhin direkt an `authenticated` (Migration 0132 hat nur die äquivalente anon-Regel entfernt, das Root Cause besteht für `authenticated` weiter).

**Tabellen-Kurzüberblick** (alle Spalten, Verhaltens-Contracts und Migrations-Historie je Tabelle in `docs/database.md`):
- `zane_exercises`: Übungs-Library (`log_mode`, `bodyweight_mode`: `'plus_load'` tippt nur die Zusatzlast, `zane_sets.kg` bleibt Gesamtlast, `added_kg` hält die getippte Zahl; Legacy-Flags laufen im Gleichschritt)
- `zane_schedules`: Trainingspläne inkl. Flex-/Meso-Feldern (Store-Objekt = DB-Column-Passthrough) · `zane_workout_templates`: Vorlagen · `zane_schedule_backups`: Auto-Snapshots der Plan-Tage · `zane_plan_drafts`: Multi-Device-Autosave des Plan-Editors (nicht im Backup)
- `zane_sessions` + `zane_session_entries` + `zane_sets`: Trainingshistorie (relational; `sessions.entries`-JSONB ist Legacy, wird nicht mehr geschrieben) · `zane_meso_states`: Meso-Autoregulation je (User, Plan) · `zane_skips`: übersprungene Trainingstage · `zane_status_periods`: Sick/Vacation/Deload-Historie
- `zane_daily_logs`: Health-Tageslog (UNIQUE user_id+date, Sync via RPC; `ai_summary`/`ai_summary_generated_at` sind server-authored von `ai-daily-summary`, Qwen primary/Claude fallback, bewusst außerhalb der Sync-RPC-Spaltenliste) · `zane_glucose_logs` / `zane_blood_pressure_logs` / `zane_body_temp_logs` / `zane_cardio_logs` / `zane_cardio_plans`: Health/Cardio · `zane_water_logs`: Wasser-Einzeleinträge, Tagessumme in `zane_daily_logs.water_ml` gespiegelt, stündliche Cron-Kompaktierung vergangener Tage
- Food-Tracker: `zane_foods` (geteilter globaler Referenz-Cache OFF/USDA, **keine** Per-User-Daten) · `zane_food_logs` (denormalisiert, Tagessummen in `zane_daily_logs` gespiegelt; `sugar`/`sat_fat`/`sodium_mg`: `null` heißt „Quelle meldet nicht", fließt nicht in Adherence) · `zane_food_favorites` (kein Coach-Zugriff) · `zane_food_recipes` (Coach-of-Client-RLS seit Migration 0200) · `zane_food_meal_plans` + `zane_food_template_slots` + `zane_food_template_days` (Plan-Mode: benannte Container, wiederkehrende Fixum-Slots materialisieren `planned`-Einträge, Auto-Fill-Marker; Coach-of-Client-RLS) · `zane_food_shopping_prefs` (Per-Food-Prefs der Shopping List: Name-Override, Excludes, Packungsgröße, Inventory/Stock; geräteübergreifend) · `zane_recipe_shares` (Token → jsonb-Snapshot, Deep-Link `?share=<token>`, Zugriff nur über RPCs, nicht im Backup)
- **Medications** (`zane_medication_plans` / `zane_medications` / `zane_medication_plan_items` / `zane_medication_schedule_slots` / `zane_medication_logs` / `zane_medication_pillbox_checks`): Tracker nach Food-Plan-Mode-Vorbild, Coach-of-Client-RLS. Ein Medikament kann via Join in mehreren Plänen stecken (je eigener Schedule); Pläne haben ein `active`-Flag (mehrere gleichzeitig aktiv erlaubt, nur aktive feuern Doses). Schedule je Slot: Wochentage **oder** `interval_days` („alle N Tage"; ausgewertet einzig in `dsSlotAppliesOn` in `store.js`, exportiert als `LB.dsSlotAppliesOn`, auch von den Medications-Screens genutzt). Feature-Master-Switch `zane_user_settings.meds_enabled`; alle vier Health-Tabs haben eigene unabhängige „Show tab"-Schalter. Inventory-Regeln (`track_stock`, `low_stock_threshold`, `exclude_from_low_stock` „Cycle only", `exclude_from_pillbox`) und die `WeeklyPrepScreen`-Packliste: `docs/database.md`. Edge Function `medication-reminder` (stündlicher Cron).
- `zane_coaching` (+ `_threads`, `_notes`, `_macros`) und `zane_checkins`: Coaching; Sonderfälle Support-Tickets (id-Präfix `support_`) und Self-Coaching (`self_`). `zane_checkins.ai_opinion`/`ai_opinion_generated_at` sind server-authored (`ai-checkin-opinion`, Qwen primary/Claude fallback), für Client und Coach identisch sichtbar · `zane_checkin_schema_templates`: bis zu 5 Schema-Vorlagen je Coach
- `zane_user_settings`: eine Zeile je User, alle Settings
- `zane_profiles` (u.a. `tier` `'free' | 'lifetime' | 'premium'`: server-authored via Trigger, Client-Writes werden still zurückgedreht, bewusst nicht im Backup; die Signup-Approval ist seit Migration 0241 **komplett entfernt**, Registrierung offen) · `zane_app_config`, `zane_feature_grants`, `zane_push_subscriptions`, `zane_pushover_active`: Admin-Config, Grants, Push
- `zane_feature_map` / `zane_feature_map_published`: Feature-Map-Override-Ebenen (siehe „Feature Map") · `zane_api_usage`: Tages-Quota-Zähler der Edge Functions, hochgezählt via `bump_api_usage` (service-role-only, siehe Grant-Fallen), nicht im Backup

**Wichtige RPCs/Functions** (alle Signaturen in `docs/database.md`):
- `sync_sets_batch` / `sync_daily_logs_batch` / `sync_meso_states_batch`: Batch-Upserts mit `updated_at`-Staleness-Guard (Multi-Device-Schutz)
- `get_exercise_best_e1rm` / `get_exercise_history` / `get_session_stats`: serverseitige History-Aggregate fürs Windowing
- Admin- (All-Users, Broadcast, Force-Update, VIP), Coaching- und Support-RPCs: siehe Referenz
- Edge Function `auto-close-sessions`: schließt abgelaufene offene Sessions (Cron alle 15 min, Timeout je User via `session_timeout_minutes`)

**Realtime:** in der `supabase_realtime`-Publikation sind `zane_coaching` und `zane_coaching_notes` (Live-Einladungen/-Nachrichten) sowie `zane_user_settings` und `zane_checkins` (Live-Badges: "Client trainiert gerade", ausstehendes Check-in); die dort ebenfalls gelisteten `door_events`/`motion_events` sind app-fremd (anderes Projekt in derselben DB, ignorieren). Laufende Sessions haben keinen Realtime-Sync: der lokale Store ist die alleinige Quelle, ein Coach pollt `get_active_session_detail`.

## History-Windowing (Kurzfassung)

Der Boot lädt konstant viele Sets, unabhängig vom Account-Alter (Details und akzeptierte Degradationen: `docs/internals.md`):

- Session-**Metadaten** vollständig, `zane_session_entries`/`zane_sets` nur für die letzten `HISTORY_WINDOW_DAYS` (70 Tage) plus die In-Progress-Session.
- Gefensterte Sessions: `entries: []` plus Aggregate `aggVolume`/`aggDoneSets`/`aggExercises`; `totalVolume()`/`doneSetCount()` fallen darauf zurück, `aggExercises > 0` unterscheidet gefenstert von echt leer. Detail-Ansichten laden Sets nach (`fetchSessionEntries`).
- PR-Erkennung: `bestE1rmForExercise` = max(Server-Aggregat `store.exerciseBests`, lokales Fenster).
- Seeds: `fetchSeedEntries` holt Server-Historie nur bei < 3 lokalen Sessions je Übung; die Session-Start-Flows awaiten das **vor** dem Anlegen der Session.
- Cache-first-Merge via `LB.mergeSessions` (unit-getestet): bestätigt Gesynctes, das der Server nicht mehr hat, wird gelöscht (Anti-Resurrection); nie Gesynctes bleibt erhalten. Gilt für Sessions, Exercises, Schedules, Skips.

## Deployment

- PWA, erreichbar unter `/training/`. Service Worker in `sw.js`.
- **Deploy läuft direkt vom jeweiligen Feature-Branch, kein Merge nach `main` nötig.** Ein Push (inkl. Cache-Bump) auf den Branch reicht.
- **SW-Cache-Version (`const CACHE = 'zane-vX.XXX'` in `sw.js`) nur auf ausdrückliche Aufforderung erhöhen.** Nicht automatisch bei jedem Commit: mit vielen aktiven Usern würde jedes kleinste Code-Update einen Update-Banner auslösen. Format `zane-vMAJOR.MINOR`, fortlaufend hochgezählt (z.B. `zane-v2.350` → `zane-v2.351`).
- **Nach einem Cache-Bump die neue Versionsnummer im Chat melden**, z.B. „SW-Cache → zane-v2.351".
