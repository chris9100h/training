# Autoregulation v2: Volume-Landmarks, Readiness & selbst-getaktete Blöcke

Status: **Entwurf / Spec.** Noch kein Code. Diese Datei ist die Bauanleitung und
der Diskussionsstand, nicht die Referenz. Wenn gebaut, wandert das Verbindliche
nach `docs/internals.md` bzw. `docs/database.md`.

## 0. Ziel & Leitprinzip

Heute ist die Volumen-Logik reaktiv und gedächtnislos: "still sore" schneidet
einen Satz, "not enough" legt einen drauf, ohne Decke. Ergebnis: Sägezahn statt
Konvergenz. Ziel: von **reaktiv** zu **verstehend** (MEV/MRV pro Muskel gemerkt),
und zwar in **allen drei Modi**, nicht nur im wochenbegrenzten Meso.

**Leitsatz, der die Modus-Frage löst:**
> Ein Block ist die Spanne **seit dem letzten Reset (Deload)**. "Wochen" sind nur
> Mesos Art, diese Grenze zu **terminieren**. Auto-Modi bekommen dieselbe Grenze,
> nur **erkannt** statt geplant.

Damit ist es **eine** Engine mit einer dünnen Mode-Policy, kein Dreifach-Code:
- **blockBoundary(mode)**: geplant (Meso) vs. erkannt (Auto)
- **throttleLever(mode)**: Sätze (Auto Full), Sätze früh cappen (Meso), Last (Load-only)
- **onReset(mode)**: Block-Backoff pro Übung (Full/Meso, §2.3) vs. Last-Drop (Load-only)

## 1. Modi

Erkennung im Code (vorhanden): `mesocycle_weeks != null` → **Meso (C)**;
`mesocycle_autoregulate` → Auto; `LB.autoregLoadOnly(sch)` unterscheidet
**Auto Full (A)** von **Auto Load-only (B)**.

| Baustein | Auto Full (A) | Meso (C) | Load-only (B) |
|---|---|---|---|
| Readiness (Heute-Regler) | ✓ identisch | ✓ identisch | ✓ identisch |
| Overreach-Detektor | ✓ | ✓ | ✓ |
| → Konsequenz | Sätze cappen → Deload vorschlagen | früh cappen, Deload eh geplant | Last halten → Deload vorschlagen |
| MEV/MRV Volumen-Landmarks | ✓ | ✓ | entfällt (Volumen fix) |
| Blockgrenze | erkannt (MRV) | geplant (Wochen) | erkannt (MRV/Fatigue) |
| MEV-Reset am Blockstart | ✓ | ✓ | entfällt |
| Stall + konkreter Swap | ✓ | ✓ | ✓ |
| Block-Recap | ✓ (seit letztem Reset) | ✓ (Meso-Ende) | ✓ (seit letztem Reset) |
| Wiedereinstieg nach Pause | ✓ | ✓ | ✓ |

Das einzig strukturell Fehlende: **B ohne Volumen-Landmarks**, per Design (fixes
Volumen ist der Sinn von B). B bekommt alles andere.

## 2. Geteilte Primitive (modus-agnostisch)

### 2.1 Mikrozyklus-Buchhaltung: harte Sätze pro Muskel

Neu, das Fundament. Heute rechnet alles pro `exId_dayId`; MEV/MRV sind
**Volumen pro Muskel pro Mikrozyklus** über alle Tage.

- **Fenster = ein Mikrozyklus, nach Plan-Struktur** (NICHT fix 7 Tage):
  - **Weekday-Plan** (`isWeekdayPlan`): pro **Woche**.
  - **Flex-Plan** (`isFlexPlan`; Meso läuft aktuell immer hier): pro **Rotation**
    (ein voller Durchlauf der Trainingstage).
  - **Cycle-Plan**: pro **Cycle** (ein Durchlauf der Version).

  Grund: die Engine taktet ihre Progression ohnehin in dieser Einheit
  (`mesoWeek` / `cycleIndex`). Die Volumen-Zählung muss dieselbe Einheit nutzen,
  sonst misaligniert sie (eine 5-Tage-Rotation ist keine Woche). **"Pro Woche"
  gilt nur im Wochenmodus.**
- **Harter Satz:** ein erledigter Working-Set (kein Warmup, kein Skip). Technik-
  Sätze (Myo/Drop/AMRAP) zählen als **1**. Partials/Stretch als Finisher zählen
  **nicht** extra.
- **Zuordnung:** `primaryMuscleForExercise`. Sätze ohne Muskel-Tag gehen in keinen
  Landmark ein.
- **Quelle:** clientseitig aus der relationalen Session-Historie; ein Mikrozyklus
  liegt im 70-Tage-Fenster, keine Server-Aggregate nötig.

Output: `cycleSets[muscle]` = harte Sätze im aktuellen/letzten Mikrozyklus.

### 2.2 Overreach-Detektor

Universeller Baustein, alle Signale sammelt ihr schon pro Session. Pro Muskel
über ein **Bestätigungsfenster** (Vorschlag: 2 aufeinanderfolgende Muskel-
Sessions, weil ein Muskel oft 2x/Woche drankommt):

- **Soreness:** wiederholt "still sore" (per-Muskel-Antwort).
- **Joint-Flags:** Joint-Feedback ≠ "none" auf Übungen dieses Muskels.
- **Performance:** Rep-Regression (fallende Reps bei gleicher Last, bzw. flach/
  fallendes e1RM) über die Übungen des Muskels.
- **Weight-feel:** "too heavy" häuft sich.

**Regel (Vorschlag):** still-sore **UND** (Rep-Regression **ODER** Joint-Flag)
über das Bestätigungsfenster → Muskel ist **an der MRV**.

**Stand-down:** eine saubere Session (nicht wund, Reps erholen sich) setzt die
Streak zurück. Kein Lernen aus einer einzelnen schlechten Woche. Signale, die von
selbst abklingen, ziehen den Detektor zurück (war evtl. nur Schlaf/Stress).

Output pro Muskel: `{ atCeiling: bool, since, evidence: [...] }`. `evidence` sind
menschenlesbare Strings (siehe §8), die direkt in Recap/Nudge wandern.

### 2.3 Landmarks: MRV-Cap (pro Muskel) + Block-Backoff (pro Übung)

Wichtige Trennung nach Rücksprache:
- **MRV[muscle] = Decke, PRO MUSKEL.** Muss pro Muskel sein: Brust erholt sich als
  Ganzes, egal über wie viele Übungen die Sätze laufen. Pro Übung gedacht hätte jede
  Brustübung ihre eigene Decke und das Gesamtvolumen explodiert. Wert = die
  Mikrozyklus-Satzzahl, bei der die Signatur zuschlug, **EMA-geglättet** über Blöcke.
- **Block-Backoff = PRO ÜBUNG.** Kein echtes MEV in v1 (echtes MEV liegt weit unter
  MRV, grob halb, und ist pro Muskel; das ist v2-Wissenschaft). Stattdessen
  pragmatisch: beim Blockstart zieht **jede Übung ~2 Sätze** von ihrem zuletzt
  erreichten Volumen ab, danach baut die normale Satz-drauf-Logik wieder hoch,
  **gedeckelt von der per-Muskel-MRV.** Decke korrekt (pro Muskel), Stellschraube
  wie gehabt (pro Übung).

Persistiert, versioniert (§9). Überlebt das History-Windowing (liegt im `mesoState`).

## 3. Blockgrenze & Reset (die Mode-Policy)

- **Meso (C):** Grenze geplant (Wochenzähler wie heute, `mesoRirForWeek` bleibt).
  Schlägt der Detektor **vor** der Peak-Woche an, wird **früh gecappt** (Volumen
  halten statt aufs geplante Peak-Volumen hochziehen); der geplante Deload kommt eh.
- **Auto Full (A):** Grenze **erkannt.** MRV-Signatur → **Deload vorschlagen** →
  bei Annahme Block-Backoff (§2.3, −2 Sätze/Übung) + neuer Ramp bis zur per-Muskel-
  MRV. Das macht Auto Full zum **selbst-getakteten Mesozyklus:** Blocklänge = deine
  Erholung, nicht eine Zahl.
- **Auto Load-only (B):** Volumen fix, also kein Volumen-Reset. Derselbe Detektor
  hält/senkt die **Last** und schlägt einen Deload vor.

**Ehrlicher Haken:** manche wählen Auto Full gerade, weil sie **keine** aufge-
zwungene Blockstruktur wollen. Der emergente Deload ist deshalb ein **Vorschlag**,
wegwischbar, plus Schalter zum Abstellen. Nie erzwungen, Weitertrainieren geht immer.

## 4. Readiness (Heute-Regler) + Signal-Hygiene

Das erste voll modus-agnostische Stück und die Basis-Infrastruktur für den Rest.

### 4.1 Session-Start
1-Tap: **Fresh / Normal / Rough**. Optionale Anreicherung aus dem Health-Tab, aber
bewusst sekundär: heute liegen dort Gewicht/Makros/Steps/Wasser/Adherence, **kein
Schlaf/Stress**, also bleibt der manuelle Tap die Primärquelle. (Gewichts-Trend/
Steps können den Vorschlag später vorbelegen.)

### 4.2 Heute-Effekt
- **Rough:** +1 RIR (näher am Vorbehalt), Earn-Ladder heute **nicht** jagen,
  optional letzten Accessory-Satz kappen.
- **Fresh:** normal, darf pushen.
- **Normal:** wie heute.

### 4.3 `signalWeight` (der Kitt für alles)
Jede Session trägt `signalWeight ∈ { full, discounted, none }`:
- **none:** Deload (heute schon: kein Feedback, kein Earn/Cut).
- **discounted:** Rough-Day, Wiedereinstiegs-Ramp.
- **full:** Normalfall.

`computeMesoGains`, der Detektor und das Landmark-Lernen **respektieren** das:
- `discounted`/`none` lösen **keinen** Rep-Miss-Cut aus und ziehen **MRV nicht runter**.
- `full`: normal.
- **Earn bleibt** auf `discounted` erlaubt: ein PR an einem müden Tag ist echt.

Das ist die generalisierte Fassung des heutigen Deload-Sonderfalls und die Brücke
zwischen §3, §4, §5 und §7.

## 5. Block-Recap (zwei Rahmungen, gleicher Inhalt)

### 5.1 Inhalt
- **Gains:** Volumen-Delta seit Blockstart (Sätze/Muskel), Last-PRs (kg), PR-Anzahl,
  beste Session. Aggregation über die schon persistierten `mesoRecap`-Daten + `mesoState`-Deltas.
- **Fatigue-Evidenz (nur Decline-Rahmung):** exakt die Detektor-Signale aus §2.2.

### 5.2 Trigger
- **Block-Ende** (Meso durch, oder Deload angenommen): reine **Feier**.
- **Mid-Block-Decline** (Overreach erkannt, Deload abgelehnt): Gains **+** Fatigue-
  Evidenz **+ ein** Nachfragen. Der Recap ist hier der Entscheidungshelfer, nicht
  der Abschluss. Garantiert zudem, dass Auto-Nutzer den Recap überhaupt je sehen.

Warum Evidenz zwingend dazu muss: nur Gains würden **gegen** den Deload
argumentieren ("läuft super, warum aufhören?"). Erst "du hast X gebaut **und** hier
ist die Ermüdung" macht es ehrlich und zugkräftig.

### 5.3 Anti-Nag-Governance
1. Detektor feuert → **leichtes** Deload-Angebot (1 Tap).
2. Ablehnen → Recap mit Evidenz → **ein** "sicher, keinen einschieben?".
3. Danach **Cooldown** (N Sessions) kein Voll-Prompt, nur ein kleiner persistenter
   Hinweis ("an der Decke, Deload verfügbar").
4. **Evidenz eskaliert, nicht die Frequenz:** taucht es nach Cooldown wieder auf,
   zeigt der Recap den gestiegenen Fatigue-Trend, faktisch überzeugender.
5. **Auto-Stand-down:** klingen die Signale ab, zieht der Nudge sich zurück.

Rote Linie: **einmal ehrlich fragen mit echten Daten, nie blockieren, nie guilt-trippen.**

## 6. Stall-Erkennung + konkreter Swap

- **Stall:** e1RM einer Übung flach/fallend über **N** Sessions **bei grünen Gates**
  (Joint none, Pump ok, Muskel nicht an der Decke). Die Gate-Bedingung unterscheidet
  "die Übung stagniert" von "du bist überreizt/im Deload". Daten: `exerciseBests` +
  lokales Fenster (+ Server-e1RM falls nötig).
- **Konkreter Swap:** Geschwister-Übung aus der Library (gleicher Primärmuskel,
  **anderes** Movement/Equipment). Wächter: nicht die gerade weggetauschte
  vorschlagen; Affinity respektieren (keine "dislike"); bevorzugt user-eigene oder
  System-Übung. Bleibt **Vorschlag**, nie erzwungen. Risiko: dünne Library → schwacher
  Vorschlag, dann lieber kein konkreter.

## 7. Wiedereinstieg nach Pause

Nach einer Status-Periode (Sick/Vacation) über Schwelle (~7 Tage). Kernprinzip,
damit es sich nie nach Verarsche anfühlt: **der Wiedereinstieg senkt den VORSCHLAG,
deckelt aber nicht die Leistung.** Die normale Earn-Logik läuft oben drauf, wer stark
zurückkommt, ist mit EINER Wiederholung wieder beim alten Gewicht. Nie unter dem
gehalten, was man tatsächlich kann.

Zwei entkoppelte Uhren, bewusst **NICHT** in rohen Sessions gezählt (das wäre auf
langen Cycles Unsinn, manche Lifts kommen gar nicht dran):
- **Pro Übung (Last):** erste Exposure zurück startet einen Tick tiefer (bzw. altes
  Gewicht bei +1 RIR); packst du es, zieht Earn dich **sofort** hoch. In der Regel
  nach 1, spätestens 2 Exposures **der Übung** zurück auf altem Niveau. Kein
  erzwungenes Hochkriechen über mehrere Rotationen.
- **Systemisch (Volumen/RIR):** milder Malus, der über **einen Mikrozyklus** abklingt
  (Plan-Einheit aus §2.1: Rotation / Cycle / Woche), nicht über X rohe Sessions. Auf
  einem 9-Tage-Cycle also **eine** Rotation Ease-in, nicht vier.

Magnitude/Dauer skalieren leicht mit der Pausenlänge (7-14 Tage minimal; Wochen:
weiter runter starten, längerer Ramp), aber immer **durch Leistung überschreibbar**.
Modelliert als abklingender Readiness-Modifier (Reuse §4) mit `signalWeight = discounted`.

## 8. Erklärbarkeit

Jede Intervention trägt einen menschenlesbaren Grund, sonst fühlt sich RP-
Intelligenz wie Willkür an. Beispiele:
- "Brust an der Decke: 3 Sessions wund, Reps 14 → 11 bei gleicher Last."
- "Bank stagniert (3 Sessions kein e1RM-Fortschritt, Gates grün) → probier Schrägbank."
- "Rough-Day: heute +1 RIR, wir zählen die Session gedämpft."

## 9. Datenmodell & Migration

- **`zane_meso_states`** (pro User+Plan): neue Spalte `autoreg_state jsonb`, ein
  versionierter Blob:
  ```
  { version, landmarks: { [muscle]: { mrv, mev, updatedAt } },
    overreach: { [muscle]: { streak, firstSeenSets, lastAt } },
    block: { startDate, startVolByMuscle },
    deloadNudge: { [scope]: { declinedAt, cooldownUntil, escalation } } }
  ```
- **`zane_sessions`**: `readiness text`, `signal_weight text`.
- **`store.js` (4 Stellen, Pflicht):** `loadFromSupabase`-Mapping, `syncStore`-Diff,
  `upsert`, `importFromBackup`. Meso-State und diese Session-Felder sind
  User-Trainingsdaten → **ins Backup** (sonst schlägt `check-backup-coverage.cjs` fehl).
- **`supabase/schema.sql`** + **`docs/database.md`** (+ Kurzüberblick) nachziehen.
- **Kein neuer RPC** nötig: die Wochenbuchhaltung läuft clientseitig über die
  ohnehin gefensterten Sets; die Cross-Block-Landmarks liegen server-persistiert im
  `mesoState`.
- Sync-Guard: `autoreg_state` fährt über `sync_meso_states_batch` mit dem
  bestehenden `updated_at`-Staleness-Schutz mit.

## 10. Parameter

**Entschieden:**
- Harter Satz: Myo/Drop zählen als **1**.
- Deload-Nudge-Cooldown: **3** Sessions, dann nur passiver Hinweis.
- Stall: **3** Sessions ohne e1RM-Fortschritt bei grünen Gates.
- Block-Backoff: **−2 Sätze pro Übung** am Blockstart; Decke (MRV) pro Muskel.
- Buchhaltungs-Fenster: ein Mikrozyklus nach Plan-Struktur (§2.1).

**Vorgeschlagen, noch zu bestätigen:**
- Detektor-Bestätigungsfenster: die **letzten 2 Mal**, die der Muskel drankam.
- Readiness "Rough": **+1 RIR** und letzten Accessory-Satz kappen.
- Wiedereinstieg: ab **7** Pausentagen; systemischer Ease-in über **1 Mikrozyklus**,
  Last-Catch-up **≤2 Exposures/Übung**, immer durch Leistung überschreibbar (§7).

**Später (nicht v1-blockierend):**
- MRV-EMA-Glättungsfaktor (Startwert im Bau festlegen, dann tunen).
- Echte MEV-Erkennung pro Muskel (v2).

## 11. Bau-Phasen (jede einzeln lieferbar + testbar)

- **P0 — Readiness + Signal-Hygiene.** Session-Start-Tap, Heute-Effekt,
  `signalWeight`-Tag, `computeMesoGains` respektiert es. Voll modus-agnostisch,
  liefert allein schon ein USP-Feature, null Lern-Risiko.
- **P1 — Wochenbuchhaltung + Detektor + MRV-Cap + Deload-Angebot.** Der geteilte
  Kern. Killt sofort das Sägezahn (A), cappt früh (C), hält Last (B). Ab hier greift
  die Grund-Intelligenz in **allen drei** Modi. Noch kein Cross-Block-Gedächtnis.
- **P2 — Recap (zwei Rahmungen) + Anti-Nag.** Nutzt P1s Detektor; der Decline-Recap
  hängt an P1.
- **P3 — Landmarks + emergente Blöcke + MEV-Reset.** Persistiert MEV/MRV, Reset an
  der Grenze, emergenter Deload → Reset für die Auto-Modi. Erst ab hier wird Auto
  Full zum selbst-getakteten Meso.
- **P4 — Stall + konkreter Swap, Wiedereinstiegs-Ramp.**

P1 ist der Dreh- und Angelpunkt: sobald der Detektor auf der Mikrozyklus-
Buchhaltung steht, ist "für alle drei Modi" gelöst, alles danach ist nur noch Policy.

## 12. Definition of Done: Guide & Feature Map aktualisieren

Wenn (Teile) der Engine live gehen, müssen die nutzerseitigen Erklärungen mit, sonst
läuft die Doku der Realität hinterher:
- **Autoreg-Guide, doppelt pflegen:** `src/screens-autoreg-guide.jsx` (In-App) **und**
  `src/autoreg-guide-page.js` (Public `autoreg.html`), inhaltlich synchron. Bei der
  Public-Seite den `?v=`-Cache-Buster im Gleichschritt mit dem SW-Cache-Bump hochziehen.
- **Feature Map:** Karte(n) in `src/feature-map-db.js` ergänzen/editieren (stabile
  `id`, kein Tech-Jargon, nur End-User-Nutzen). Erscheint automatisch für alle.
- **Pro Phase ans Ende:** jede Phase, die sichtbares Verhalten ändert (Readiness,
  Cap-Meldungen, Recap, Stall-Vorschlag), zieht Guide + Feature-Map-Karte nach. Damit
  bleibt "alles auf Stand" ein Schritt jeder Phase, kein Nachlauf-Projekt.
