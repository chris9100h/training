# Logbook Redesign — Migration Bundle

**4 geänderte Dateien**, die du in deinen `redesign`-Branch ziehst.

## Was sich ändert

| Datei | Status |
|---|---|
| `index.html` | **NEU** — Cormorant-Font, neue CSS-Variablen, sw.js mit `.catch()` |
| `ui.jsx` | **NEU** — Komplettes Design-System (alle alten API-Namen bleiben, neue Primitives `Frame`, `BracketFrame`, `SubDial`, `CrownButton`, `Bezel`, `ScreenHead`, `Hairline`, `TickRow`, `NumInput`, `Field`, `TextInput` dazu) |
| `screens-home.jsx` | **NEU** — Login (Watch-Dial-Logo) + Home (CrownButton-Hero, Tag-Streifen, In-Progress-Overlay als BracketFrame). Funktional 1:1 zum Original. |
| `screens-train.jsx` | **NEU** — Hero-Set-Layout, alle Sätze klein darunter, Bracket-Frame um Hero, Pause-Timer als Frame. Funktional 1:1. |

## Was **unverändert** bleibt

- `app.jsx` — Routing, Auth-Listener, Service-Worker-Update, Wake-Lock, Cache-Recovery
- `store.js`, `supabase.js`, `sw.js`, `manifest.json`, `icons/`, `supabase/`, `supabase-schema.sql`
- `screens-schedule.jsx` — Plan, Schedule-Detail/Edit/New, DayEditor, DayTypePicker, ExercisePicker
- `screens-lib.jsx` — Library, ExerciseDetail, History, SessionDetail (inkl. Screenshot-Export), Settings

Die zwei großen Screens-Files (`schedule` + `lib`) erben das neue Aussehen automatisch über die reskinned `ui.jsx`-Primitives (Screen, TopBar, Card, Btn, Pill, Sheet, Stepper, Empty etc.). Falls dir an einzelnen Sub-Screens noch was nicht gefällt, sag Bescheid — dann porte ich die einzeln nach.

## Migrations-Schritte

```bash
git checkout redesign

# entpacke das ZIP in den Repo-Root, sodass die 4 Dateien überschrieben werden

git status     # → 4 modified files
git diff       # zum Drüberschauen
git add index.html ui.jsx screens-home.jsx screens-train.jsx
git commit -m "Apply Haute Horlogerie redesign"
git push origin redesign
```

## Was im Auge behalten

- **Schriftarten laden vom Google CDN** — falls deine PWA offline sein soll, müsstest du Cormorant lokal hosten (kann ich dir vorbereiten, wenn nötig).
- **Schedule + Library Screens** sehen dank reskinned ui.jsx anders aus, sind aber im Layout identisch. Wenn du da auch das volle Treatment willst (BracketFrames, SubDials, ScreenHead-Header), sag Bescheid.
- **Service Worker `/training/sw.js`** — ich habe ein `.catch(() => {})` ergänzt damit lokal außerhalb von `/training` keine unhandled rejection kommt. Bei dir in Production läuft das genauso.
- **Keyframe `rowFlash`** verwendet jetzt `var(--ok)` (grünlich) — falls du den alten gold-Flash willst, in `index.html` die Farbe anpassen.

## Design-Sprache in Stichworten

- **Cormorant Garamond** für Titel & Display-Headlines (kursive Akzente)
- **Inter** für UI-Body & Labels
- **JetBrains Mono** für alle Zahlen, tabular numerals
- **Hairlines 0.5px** statt 1px → präzise, watch-dial Anmutung
- **Champagner-Gold** `#c9a961` statt `#d4a437` (wärmer)
- **Warmer Schwarz-Ton** `#07060a` statt `#0c0c0c`
- **CrownButton** — radial-gradient Gold mit konzentrischen Ringen, dezent pulsierend
- **BracketFrame** — Eckwinkel statt voller Umrandung
- **SubDial** — runde Chronograph-Hilfszifferblätter
- **Floating Dock** statt fester Tab-Bar — pillenförmig, mit goldenem Position-Indikator der animiert
- **Micro-Tags** — `REF.` Codes, `SWISS MADE`, `CAL. M.01` für Watch-Brand-Anmutung
