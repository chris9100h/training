# Theme-/Akzent-Audit 2026-08

Datum: 2026-08-05. Lesbarkeits-Audit über alle Themes (dark, black, light, paper inkl. Paper-Akzent-Opt-out) × 10 Akzentfarben. Methodik: deterministische WCAG-Kontrastmatrix (50 effektive Kombinationen, 22 Farbpaare, exakt mit den Formeln aus `index.html` gerechnet: 439 geflaggte Zellen im Ausgangszustand) + 6 semantische Verify-Agents über alle Screens (~55 CONFIRMED, ~4 PLAUSIBLE, ~9 REFUTED) + 1 abschließende adversariale Verifikation der Fixes. **„über alle Screens" stimmte beim ersten Durchgang nicht ganz: siehe „Nachtrag: Abdeckungslücke" unten, inzwischen geschlossen.**

Status: **[BEHOBEN]** auf Branch `claude/theme-audit-fixes-2026-08` (Commit siehe Git-Log). SW-Cache-Bump nur auf Ansage.

## Befundklassen (Audit)

1. **ok/warn/info ohne light/paper-Overrides**: `--ok` (2.10:1), `--warn` (2.73:1), `--info` (2.71:1) auf light/paper unlesbar, dieselbe Bug-Klasse, die `--danger` bereits per-Theme gelöst hatte. Betroffen: Makro-Zahlen (Carbs=ok, Protein=info, ~25 Call-Sites), Kalorien-Zahlen in warn (24 Call-Sites), Adherence-Ring/Prozent, Sync-Dumbbell, Autoreg-Stat-Werte, Trend-Pfeile, Check-in-Feldbadges, Stock-Zahlen, Pace-Hinweise.
2. **red-Akzent zu dunkel für dark/black**: Text 2.22:1, Button-Fill-Ink 2.53:1, Deep-Text 1.41:1. Betraf alle Primary-Buttons, TabBar-Plate, Home-Hero, Session-Eingaben, Badges, PR-Feier, Onboarding-Mockups.
3. **Fixfarben-Kollisionen**: ok↔green (26), warn↔copper (40), info↔blue/indigo (36-37), danger↔orange auf light (32), success↔green (28).
4. **inkFaint/inkGhost auf black**: inkFaint 2.57:1, inkGhost als Echttext (Chart-Achsen, AMRAP-Labels, Meta-Zeilen) 1.33:1.
5. **Einzel-Fixes**: hardcoded `stroke="white"` auf Akzent-Fill (cardio, 1.9:1 auf Gold), Ember-Farben auf light (2.4-2.6:1), festes Glucose/Wasser-Blau `#4a9fe0` auf light (2.46:1), START-WORKOUT-Text mit opacity 0.75.

## Fixes (2026-08-05)

### Token-System (`index.html`)

- **`--ok`**: dark `#7fd4a0` (Mint, Distanz ≥ 68 zu allen 10 Akzenten, Kontrast 9.9:1 auf dark) · light/paper-Override `#1b6a45` (5.6:1, Distanz ≥ 40)
- **`--warn`**: dark `#e6b800` (Amber-Gelb, Distanz ≥ 83, Kontrast 9.4:1) · light/paper `#6d5400` (6.2:1, Distanz ≥ 40)
- **`--info`**: dark `#8fa3ea` (Periwinkle, Distanz ≥ 57 zu Akzenten, 90 zu ok, Kontrast 7.2:1) · light/paper `#6a58a8` (5.0:1, Distanz ≥ 74)
- **`--ok-rgb`/`--warn-rgb`/`--info-rgb`** neu gespiegelt; `applyDarkMode` setzt alle sechs aus Theme-Overrides (`_DARK_OK`/`_DARK_WARN`/`_DARK_INFO`-Defaults für dark/black), nach dem `--danger`-Vorbild
- **`--success-text`** (+ `successTintXs`/`successBorder`): auf die neuen ok-Werte angeglichen (dark `#7fd4a0`, light/paper `#1b6a45`); `rowFlash`-Keyframe und `:root`-Fallbacks von den alten Werten befreit
- **ACCENT_PALETTE.red**: hex `#c05555`, light `#d47777`, deep `#a84b4b` (Text 2.22 → 3.91:1, Fill-Ink 2.53 → 4.45:1; auf light unverändert über den Darken-Pfad abgesichert)
- **DARK_MODES.black**: `inkFaint`-Alpha 0.34 → 0.45 (2.57 → 3.76:1)

### Screens

- **inkGhost → inkFaint** an allen Echttext-Stellen (~30): Coaching-Chart-Achsen (3 SVG-Fills), AMRAP-Labels + PLAN/PREV-Badges + prev-Daten in beiden Client-Tabs (Overview + Sessions), "First time, no weight data yet", "no plan", Train-Drops-Labels/warmupPct/myo-Werte/Round-Labels/Reps-missed/Declined/Rest-is-over, Wasser-Zeiten, Empty-Hour-Labels (Meds + Food), `fdEntryMeta`-Buchstaben + `:00`-Ticks + goal-Suffix (Food), Settings-Watermark-Beschreibung + `00:00`, Health-Tages-Targets + Wasser-Zeiten, Lib-Beschreibungen
- **`screens-cardio.jsx`**: Checkbox-Häkchen `stroke="white"` → `stroke="var(--accent-ink)"`
- **`screens-train.jsx`**: Ember-Farben theme-aware (light `#b0430f`/`#9f4a0e`/`#855407`, alle ≥ 4.5:1 auf raised); done-Set-Index-Box goldDeep → gold
- **`screens-health.jsx`**: Glucose-fed-Serie, fed-Referenzlinie, Wasser-Balken: `isLightCanvasActive() ? '#0369a1' : '#4a9fe0'` (Muster wie BP-DIA)
- **`screens-home.jsx`**: START-WORKOUT-Label opacity 0.75 → 1

## Verifikation

- **Matrix final**: 439 → 169 geflaggte Zellen; davon 61 BAD<3 ausschließlich in den bewusst-dekorativen Klassen (accent-deep als Border/Gradient, inkGhost-Dekoration). Token-Ebene (`--ok`/`--warn`/`--info`/`--danger`/Akzente/`inkFaint`) ist damit vollständig erfasst. Die Behauptung "alle Echttext-Nutzungen migriert" war beim ersten Durchgang zu optimistisch, siehe Nachtrag. **Alle Text-Token ≥ 4.5:1 auf allen Flächen aller 50 Kombinationen; Akzent-Text ≥ 3.0:1 überall** (worst: red auf dark 3.91) gilt weiterhin für die Token selbst, unabhängig davon, welcher Screen sie referenziert.
- **Adversariale Verifikation** (unabhängiger Agent, 7 Angriffswinkel): alle kontrastkritischen Claims bestätigt; gefundene Reste wurden nachgezogen (ok↔info-Kollision im Makro-Pairing durch Periwinkle-info gelöst, 7 übersehene inkGhost-Duplikatstellen, Ember-light-Werte nachjustiert, `rowFlash`/`:root`-Fallbacks, Kommentar-Akkuratheit wiederhergestellt). Gates: check-syntax 26/26, check-emdash clean, store.test 504/504.

## Nachtrag: Abdeckungslücke (2026-08-05, zweite Runde)

Unabhängige Review (eigene Nachrechnung aller WCAG-Werte oben gegen die tatsächlichen Hex-Werte in `index.html`, alle bestätigt exakt) fand eine Lücke in der Screen-Abdeckung, nicht in der Farbmathematik: tatsächlich angefasst wurden cardio, coaching-**client** (nicht core/detail/tabs), food, health, home, lib, medications, settings, train. Vier Coaching-Dateien minus eine, plus **`screens-onboarding.jsx`** (Welcome-Tour) und **`screens-schedule.jsx`**, waren nie Teil des Fix-Durchgangs, obwohl `inkGhost` ein globales Token ist und dieselbe 1.33-1.97:1-Lücke dort identisch zuschlägt. Stichprobe zeigte echten Fließtext, keine Deko, u.a. Onboarding-Instruktionen ("Tap the ✓ on the active row to confirm the set", "Marks unchecked sets as skipped and moves to the next exercise"), eine Chat-Meta-Zeile in `screens-coaching-core.jsx` (exakt die Kategorie, die der ursprüngliche Fix für die Coaching-Client-Tabs schon als behoben auflistete, nur eine Datei weiter) und Instruktionstext im Check-in-Schema-Builder (`screens-coaching-detail.jsx`).

**Fix:** dieselbe `inkGhost` → `inkFaint`-Migration wie im ersten Durchgang, jetzt für die fünf übersprungenen Dateien, mit derselben Abgrenzungsregel (reiner Icon-Glyph, rein dekoratives Füllelement ohne Text, oder ein bewusster "—"-Platzhalter im leeren Zustand einer sonst befüllten Werteanzeige bleiben `inkGhost`; jeder Fließtext/Zahlenwert, den ein Nutzer liest, wechselt zu `inkFaint`):

- `screens-onboarding.jsx`: 29 von 38 Stellen migriert (9 Icons/Deko-Balken bleiben)
- `screens-coaching-detail.jsx`: 20 von 31 (11 Icons/Disabled-Reset-Button/"—"-Platzhalter bleiben)
- `screens-coaching-core.jsx`: 1 von 2 (Chat-Sender+Zeitstempel-Zeile; das "×"-Glyph im Delete-Button bleibt)
- `screens-schedule.jsx`: 3 von 6 (Technique-"none"-Label, Exercise-DB-Hinweistext, Wizard-Fortschrittszähler migriert; zwei Disabled-Button-Farben und ein "—"-Platzhalter bleiben)
- `screens-coaching-tabs.jsx`: 0 von 4 (alle vier bereits korrekt: 3 Icons, 1 Status-Dot-Füllung ohne Text)

53 Stellen migriert. Gates erneut grün: check-syntax 26/26, check-emdash clean, store.test 504/504.

## Dokumentierte Rest-Nähen (bewusst, kein Fix)

- **danger↔orange/copper/red auf light (Distanz 32-42)**: danger ist Ghost (Text+Border), Akzente sind Fills; die Formunterscheidung trägt die Semantik. Gleiches für danger↔red auf dark (38).
- **red-Akzent-Text auf dark/black: 3.91-4.45:1** (statt 2.22-2.53 vorher): bewusst gegen die danger-Kollision getauscht; kein Element mehr unter 3.0:1.
- **accent-deep als Text**: nur noch als Border/Gradient im Einsatz (die einzige Text-Nutzung, die Set-Index-Box, nutzt jetzt gold).
- **inkGhost** bleibt für echte Dekoration/disabled-Zustände (1.33-1.97:1, gewollt).

## Deployment

Alles Frontend, keine Migration. Deploy direkt vom Branch (Push), SW-Cache-Bump (`sw.js`) nur auf Ansage.
