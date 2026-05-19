# Logbook — Projektkontext für Claude

## Architektur

- **Kein Build-Step.** Keine npm-Pakete verwenden. Abhängigkeiten laufen über CDN-Scripts in `index.html` (React 18, Babel Standalone, Supabase JS).
- **Dateistruktur:**
  - `index.html` — CSS-Variablen, globale Styles, Animationen, Skripte
  - `ui.jsx` — gemeinsame UI-Komponenten (UI-Objekt, Screen, TopBar, TabBar, Btn, Card, …)
  - `app.jsx` — Root-Komponente, Auth, Routing, Store-Sync
  - `screens-home.jsx`, `screens-schedule.jsx`, `screens-train.jsx`, `screens-lib.jsx` — einzelne Screens
  - `store.js` — Supabase-Lesen/Schreiben, Auth-Funktionen
- **Theme:** CSS Custom Properties in `:root` (kein CSS-Framework). Akzentfarbe läuft über `--accent`, `--accent-light`, `--accent-deep`, `--accent-rgb`. Keine hardcodierten `rgba(r,g,b,x)`-Werte für die Akzentfarbe verwenden — immer `rgba(var(--accent-rgb), x)`.

## Konventionen

- **DB-Spalten:** `snake_case` (z.B. `accent_color`, `rest_default`)
- **Store-Felder:** `camelCase` (z.B. `accentColor`, `restDefault`)
- **Neue Settings** müssen immer an drei Stellen in `store.js` ergänzt werden:
  1. `loadFromSupabase` — Mapping DB → Store
  2. `settingsChanged`-Check in `syncStore`
  3. `upsert`-Objekt in `syncStore`

## Datenbank (Supabase)

Migrationen liegen in `supabase/migrations/` als nummerierte SQL-Dateien (`0001_...sql`, `0002_...sql`, …).

**WICHTIG:** Wenn eine DB-Änderung (neue Spalte, neue Tabelle) notwendig ist:
1. Eine Migration in `supabase/migrations/` anlegen
2. Den Nutzer explizit darauf hinweisen, dass sie ausgeführt werden muss

### Aktuelle Tabellen & Spalten

**`exercises`:** `id` (text), `user_id` (uuid), `name`, `note`, `category` (text), `tags` (array), `unilateral` (boolean)

**`profiles`:** `id` (uuid), `name` (text)

**`pushover_active`:** `id` (text), `nonce` (text)

**`schedules`:** `id` (text), `user_id` (uuid), `name` (text), `days` (jsonb)

**`sessions`:** `id` (text), `user_id` (uuid), `schedule_id`, `day_id`, `day_name` (text), `date`, `started_at`, `ended` (timestamptz), `entries` (jsonb)

**`user_settings`:** `user_id` (uuid), `active_schedule_id` (text), `cycle_index` (int), `cycle_start_date` (text), `last_advanced_date` (date), `in_progress_session_id` (text), `unit` (text), `rest_default`, `rest_big`, `rest_medium`, `rest_small` (int), `push_enabled` (boolean), `cycle_week_view` (boolean), `accent_color` (text)

## Deployment

PWA, erreichbar unter `/training/`. Service Worker in `sw.js`.
