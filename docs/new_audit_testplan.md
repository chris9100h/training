# Testplan: Branch `claude_fixes_everything`

Stand: Migration 0213 ausgeführt, 8 Edge Functions deployt, CI grün.
SW-Cache ist **nicht** gebumpt, zum Testen also hart neu laden bzw. den
"Clear cache & reload"-Weg nehmen, sonst siehst du den alten Code.

Reihenfolge ist nach Risiko sortiert. A und B würde ich vor einem Merge
machen, C sind Entscheidungen die du absegnen solltest, D ist ein schneller
Durchklick, E läuft im Hintergrund.

---

## A. Kritisch: die Datenverlust-Pfade

### A1. Backup-Export enthält die volle Food-Historie
Der Bug: Export reichte nur die letzten 30 Tage durch, der Import löscht aber
alle Food-Logs. Ein Restore hat also alles Ältere vernichtet.

1. Settings, Export JSON.
2. Datei öffnen (bei .gz vorher entpacken), nach `"foodLogs"` suchen.
3. **Erwartet:** Einträge mit Datum älter als 30 Tage sind drin.
   Gegencheck: ältestes `date` im Export vs. dein ältester Food-Eintrag.

### A2. Restore mit Unit "Mixed" rechnet Gewichte NICHT um
Der Bug: mixed (kg + mi) wurde als Mismatch gegen kg gelesen, alle Gewichte
mal 2,20462.

**Nicht auf dem Produktivkonto testen.** Wenn du es testest, dann mit einem
Zweitkonto oder direkt nach einem frischen Export.

1. Settings, Unit auf Mixed stellen.
2. Import JSON öffnen, Datei wählen.
3. **Erwartet im Confirm-Dialog:** KEIN Satz "Weights will be converted...".
   Steht er da, sofort abbrechen und mir Bescheid sagen.
4. Bei echtem kg-Backup und Unit lbs muss der Satz dagegen erscheinen.

### A3. Restore-Flow: Schritt 1 kann nicht mehr still fehlschlagen
1. Settings, Import JSON.
2. **Erwartet:** über Button 2 steht ein gelber Hinweis "No backup downloaded
   yet in this session...".
3. Button 1 tippen, Datei kommt.
4. **Erwartet:** Button 1 heißt jetzt "1 · Backup downloaded ✓", der gelbe
   Hinweis ist weg.
5. Sheet schließen und neu öffnen: Hinweis ist wieder da (bewusst).

### A4. Status auf einem vergangenen Tag
Der Bug: "Normal" auf einem alten Tag hat die aktuell laufende Sick-Periode
gelöscht.

1. Heute als Sick markieren.
2. Health, im Datumsstreifen einen Tag zurück, der zu einer ALTEN,
   abgeschlossenen Sick-Periode gehört.
3. Dort "Normal" tippen.
4. **Erwartet:** heute steht weiterhin auf Sick. Der alte Tag ändert sich.
5. Danach heute wieder auf Normal stellen.

---

## B. Sync und Multi-Device

### B1. Food loggen mit schlechtem Netz (der Sync-Wedge)
Der Bug: ein Food-Log, dessen Cache-Zeile nicht landete, hat den ganzen
Sync-Loop blockiert, inklusive Workouts.

1. Flugmodus an, oder DevTools-Netzwerk auf Offline.
2. Food-Tab, ein Suchergebnis loggen (kein Favorit, kein Custom).
3. Netz wieder an, ein bis zwei Minuten warten.
4. **Erwartet:** Sync-Status geht auf grün/synced, nicht dauerhaft rot.
5. Danach ein Workout starten, einen Satz loggen, Sync muss weiter sauber sein.

### B2. Settings über zwei Geräte
Der Bug: das Gerät mit dem älteren Cache hat seine Werte über den
Serverstand geschrieben.

1. Auf Gerät A die Makro-Ziele ändern (Health, Targets).
2. Auf Gerät B die App öffnen (App war vorher offen, also alter Cache).
3. **Erwartet:** B zeigt die NEUEN Ziele.
4. B kurz offen lassen, dann A neu laden.
5. **Erwartet:** A zeigt weiterhin die neuen Ziele, nicht die alten zurück.

Gleiches Muster lohnt sich für: Meal Windows, Rest-Defaults, versteckte
Health-Karten, Plan Mode.

### B3. Account-Wechsel ohne Reload
Der Bug: eine langsame Ladeanfrage von Konto A konnte in Konto B landen.

1. Abmelden, direkt danach mit einem ZWEITEN Konto anmelden, ohne die Seite
   neu zu laden.
2. **Erwartet:** keine Übungen, Pläne oder Historie des ersten Kontos.
   Am besten mit einem Konto testen, das sichtbar andere Daten hat.

### B4. Offline gelöschte Einträge bleiben gelöscht
1. Auf Gerät A einen Wasser- oder Glukose-Eintrag löschen.
2. Auf Gerät B die App in den Hintergrund und wieder nach vorn holen.
3. **Erwartet:** der Eintrag ist auch auf B weg und kommt nicht zurück.

---

## C. Verhaltensänderungen, die du absegnen solltest

Das sind bewusste Entscheidungen von mir. Wenn dir eine nicht passt, sag es,
das ist jeweils eine kleine Änderung.

- **Adhärenz wird nicht mehr rückwirkend neu bewertet.** Änderst du heute die
  Makro-Ziele, behalten vergangene Tage ihre damalige Bewertung. Vorher wurde
  die ganze Historie neu gerechnet.
  *Prüfen:* Adhärenz eines alten Tages notieren, Ziele ändern, alten Tag
  nochmal ansehen. Wert muss gleich bleiben.

- **Weekday-Pläne:** ein geänderter Day-Typ oder ein importierter Day löst
  jetzt den Versions-Prompt aus ("ab wann gilt das?"). Vorher galt es
  rückwirkend für die ganze Historie.

- **Flex-Toggle** fragt jetzt nach, bevor er die REST-Days löscht.

- **Coaching-Tab-Schalter** ist ausgegraut, solange eine aktive Coaching-
  Beziehung besteht (vorher sprang er nur zurück).

- **Readiness-Sheet** hat jetzt "Not now" und lässt sich per Backdrop
  schließen. Das stempelt dieselbe Vorgabe wie eine fortgesetzte Session
  ('normal', bzw. 'reentry' nach einer Pause).

- **Session-Changes-Sheet:** Backdrop-Tap beendet die Session nicht mehr,
  sondern bringt dich zurück. Beenden nur noch über "Leave plan".

- **Meal-Plan-Import ist neu** (Food, Plan, Manage, "Import (JSON)").
  *Prüfen:* einen Meal-Plan exportieren, importieren, Slots vergleichen.

- **Admin-Polling** der aktiven Sessions läuft nur noch bei offenem Sheet im
  2-Sekunden-Takt, sonst einmal pro Minute.

---

## D. Schneller Durchklick (UI)

- **Fehlermeldungen:** überall wo früher ein Browser-Dialog kam, kommt jetzt
  ein gestyltes Overlay. Gut sichtbar z.B. bei einem fehlgeschlagenen
  Coaching-Write oder in der Feature-Map. Prüfen: passt es zum Theme, lässt es
  sich per Klick, Escape und Backdrop schließen?
- **Health, Glukose:** ungültigen Wert speichern. Erwartet: "Invalid reading",
  nicht stilles Nichts.
- **Health, Karten sortieren:** eine Karte im 2-Spalten-Grid nach rechts
  ziehen. Das ging vorher gar nicht.
- **Health, Karten-Reihenfolge:** eine Karte ausblenden, andere sortieren,
  Karte wieder einblenden. Erwartet: sie ist wieder an ihrer alten Stelle,
  nicht ganz unten.
- **Library, Recent:** der angezeigte letzte Satz darf kein Warm-up-Satz sein.
- **Library, Session bearbeiten:** eine Zeit-Übung (Plank) und eine
  Checkbox-Übung öffnen. Erwartet: Sekundenfeld bzw. Done-Schalter statt zwei
  leerer kg/reps-Felder.
- **Historie, Top Exercises:** eine gelöschte Übung erscheint als "Deleted
  exercise" in kursiv und ist nicht mehr antippbar.
- **Onboarding-Tour:** Appearance-Slide zeigt vier Themes inkl. Paper, der
  Skip-Slide zeigt den echten Footer.
- **Em-Dashes:** in What's New, Home und Health sollte nirgends mehr ein
  langer Gedankenstrich stehen. Die alleinstehende Platzhalter-Glyphe bei
  leeren Werten bleibt bewusst.

---

## E. Läuft im Hintergrund, in den nächsten Tagen prüfen

- **Pushover doppelt:** wer Pushover aktiv hat, darf Reminder, Auto-Close und
  Coaching-Nachrichten nur noch EINMAL bekommen, nicht zusätzlich als Web Push.
- **Auto-Close:** eine Session offen lassen, bis das Timeout greift. Erwartet:
  genau eine Benachrichtigung, Session sauber beendet.
- **Food-Quota:** normales Loggen darf das Tageslimit nicht mehr in
  Dreierschritten verbrauchen. Auffällig wäre eine 429-Meldung im normalen
  Betrieb.
- **Wasser:** nach dem stündlichen Cron darf der Vortag nicht doppelt zählen.
- **Water-Screen über Mitternacht** offen lassen, danach einen Eintrag machen.
  Erwartet: er landet auf dem neuen Tag.

---

## F. Was ich nicht prüfen konnte

- **Lokal kein Node**, also keine Transpilation vor dem Push. Die einzige
  echte Absicherung ist CI, die ist grün.
- **Der Restore-Pfad** ist destruktiv, ich habe ihn nur gelesen, nie
  ausgeführt. A1 und A2 sind deshalb die wichtigsten Punkte der Liste.
- **Push-Zustellung** hängt am `PUSHOVER_TOKEN`-Secret. Der alte Code hatte
  einen Literal-Fallback, der neue nicht. Eine erfolgreiche Verification NACH
  dem Deploy ist der Beweis.
- **Coach-Sicht** konnte ich nicht durchspielen, dafür braucht es zwei Konten
  mit aktiver Beziehung. Betroffen: Check-in-Trendkarten (Delta bei
  Auswahlfeldern), Meal-Plan-Fehlermeldung, Client-Health in Client-Einheiten.

---

## Offene Punkte

- Commit `44dd203` (Em-Dash-Sweep der Edge Functions) ist noch nicht gepusht.
- In `pushover/index.ts` steckt noch ein hardcodierter Pushover-USER-Key als
  Fallback. Auf Wunsch ziehe ich den analog auf ein Secret.
- SW-Cache ist nicht gebumpt. Ohne Bump bekommen deine Nutzer den neuen Code
  nicht.
