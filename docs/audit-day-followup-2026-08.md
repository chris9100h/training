# Audit-Day Follow-up Deep Review (2026-08-09)

**Scope:** Dieser Report enthält **ausschließlich neue Findings** nach dem heutigen Investor-Audit und den bereits gelandeten Fixes. Bereits geschlossene Bugs und reine Produkt-/Competitive-Lücken stehen auf der Denylist und werden **nicht** erneut als offen geführt.

---

## Executive Summary

| Metrik | Wert |
|---|---|
| Raw Findings (Scan) | 85 |
| Verifiziert | 28 |
| Rejected (nicht haltbar / out of scope) | 5 |
| Interne Duplikate (collabsiert) | 2 → 1 Finding |
| **Confirmed unique** | **20** |
| Critical | 0 |
| High | 14 |
| Medium | 6 |
| Low | 0 |
| Unverified | 0 |
| Scan domains ok / fail | 11 / 0 |

**Denylist (nicht erneut melden):** plus_load Keyboard total-vs-belt Korruption; auto-close Hard-Delete untracked Sessions mit Sets (bzw. close-PATCH Orphan-Cascade); Sign-out 5s-Timeout als Success-Wipe; silent finish Auto-Seal seeded incomplete Sets; Boot-Merge drop von weekPlanStartDate/statusMode/cardio/deload-Scalars bzw. open statusPeriods-Widerspruch; Library Recent false first-run empty / windowed Recent ignore; Recent-Trend zählt Warmups; Session-Detail set-vs-last-time skippt windowed Priors; History Cardio Dead-End empty; Meds Timeline empty → Schedule; recipe Plan it ohne planMode; Coach Plan create/edit blank initialTab plan; Coach „Updated plan“ Note vor confirmed Client-Sync. Ebenso reine Produkt-Gaps (HealthKit/Store/Watch, Steps-Sensoren, Food one-tap, Rest-Modal Default, Meso mid-set Sheets, Coach Invite Links), sofern kein neuer technischer Root Cause.

**Scan-Coverage:** security-grants, sync-data-integrity, train-logic-residual, schedule-cleanup, food-units-plan, health-meds-cardio, coaching-isolation, home-lib-windowing, shell-sw-a11y, edge-ai-cron, incomplete-ci-docs.

---

## Critical

*Keine.*

---

## High

### [ci-docs] Grant-Drift prüft nur `anon`, nicht `authenticated`

- **File:** `tools/check-db-live.cjs` (Inventory: `schema.sql` / Migration 0142)
- **Domain/Angle:** security-grants
- **Issue:** Der wöchentliche Live-Grant-Check und `admin_schema_inventory` asserten nur `has_function_privilege('anon', …)`. `docs/database.md` Falle 3: Default Privileges vergeben weiter `EXECUTE` an `authenticated` für jede neue Function. Eine neue service-role-only `SECURITY DEFINER` RPC kann für alle eingeloggten User callable bleiben, ohne dass CI/Automation rot wird.
- **Evidence:** `EXPECTED_ANON_EXEC` + Loop nur auf `anon_exec` (`check-db-live.cjs` ~111, 256–277); Inventory baut Functions nur mit `anon_exec`; `schema.sql` REVOKE Default nur für `anon` (~19–20), nicht für `authenticated`.
- **Why new:** Nicht in der Investor-Fix-Liste; Klasse „Missing Automation“ jenseits des bereits gefixten `bump_api_usage`-Revokes.
- **Suggestion:** Inventory um `authenticated_exec` erweitern; Allowlist service-role-only Functions (`bump_api_usage`, `collapse_water_logs`, `admin_schema_inventory`, interne Guards) mit `authenticated=false` erzwingen. Ideal: Default-Privileges-Regel für `authenticated` analog 0132 (anon) entfernen.

### [data-integrity] Adherence-Reconciler bump’t `updatedAt` und stompt Multi-Device Daily Logs

- **File:** `src/screens-health.jsx`, Sync: `src/store.js` / `sync_daily_logs_batch`
- **Domain/Angle:** sync-data-integrity
- **Issue:** Food-/Adherence-Reconciler und Day-Type-Heal schreiben `{...log, adherence, targetsSnap, updatedAt: now}`, sobald abgeleitete Felder abweichen. `sync_daily_logs_batch` macht LWW über die **gesamte** Daily-Log-Zeile (weight, steps, macros, notes, coach fields, …). Ein Gerät, das nur Adherence rechnet, kann damit frischere Multi-Device-Edits anderer Felder überschreiben, wenn die lokal noch stale sind.
- **Evidence:** `screens-health.jsx` ~4545–4551, ~4607–4610 (expliziter Kommentar: Bump nötig für Staleness-Guard); `store.js` mappt Full Payload in die RPC; Schema `ON CONFLICT … WHEN updated_at < EXCLUDED.updated_at`; `mergeCollectionById` hält dirty local ohne Field-Merge.
- **Why new:** Heute gefixt waren `mergeBootScalars` und Sign-out-Flush-Honesty, nicht Daily-Log-Staleness + Health-seitige `updatedAt`-Inflation.
- **Suggestion:** `updatedAt` nur bei user-authored Fields bump’en; schmaler Adherence-only Write-Pfad; oder Field-level Merge mit getrennter Staleness. Reine Recompute-Side-Effects dürfen den LWW-Timestamp nicht vorziehen.

### [data-integrity] plus_load: Seed-Pipeline strippt `addedKg`

- **File:** `src/store.js` (`bestEntryFromSetLists`, `withPlusLoad`, `bestRecentEntry` / `fetchSeedEntries`); Server: `get_exercise_history`
- **Domain/Angle:** train-logic-residual
- **Issue:** Produktion seedet über `bestEntryFromSetLists`, das Working Sets nur als `{kg,reps…}` neu baut und **`addedKg` verwirft**. `withPlusLoad` sieht `prevAdded == null` und nullt `kg`/`addedKg`. `get_exercise_history` liefert im Set-JSONB kein `added_kg`. Unit Tests bauen `last` mit `addedKg` handisch und grün-lichten einen Pfad, den die App so nicht fährt.
- **Evidence:** `bestEntryFromSetLists` ~3475–3478 ohne `addedKg`; `withPlusLoad` ~3356–3357; Session-Builder speisen `seedRefs ?? bestRecentEntry` in `buildSeedSets`; `mapEntryRows` lädt `addedKg` aus DB, Rebuild strippt es.
- **Why new:** Heutiger Fix war Keyboard `dispWeight`/`weightPatch` auf der Live-Set-Zeile; die Seed/History-Pipeline war unberührt.
- **Suggestion:** `addedKg` im Winning Set in `bestEntryFromSetLists` erhalten; `added_kg` in `get_exercise_history`; Unit Test `bestRecentEntry → buildSeedSets` hält Belt Load für plus_load.

### [edge] auto-close stamp’t `is_cleanup` ohne `startedUnderCleanup`-Prädikat

- **File:** `supabase/functions/auto-close-sessions/index.ts` (Client-Kontrakt: `src/screens-train.jsx`, `src/store.js`)
- **Domain/Angle:** train-logic-residual / schedule-cleanup *(zwei Scan-Winkel, ein Root Cause)*
- **Issue:** Auto-close setzt `is_cleanup: true`, sobald `settings.status_mode === 'cleanup'`. Select lädt **kein** `status_mode_since`. In-App-Finish stamp’t nur bei `startedUnderCleanup` (`startedAt >= statusModeSince`). Pending Cleanup (future-aligned) oder Session, die vor Cleanup-Start lief, kann so fälschlich als Cleanup geschlossen werden → raus aus PR-Baselines (`bestE1rmForExercise` skippt `isCleanup`), falsche Flex-Cleanup-Zählung.
- **Evidence:** auto-close select ~81 nur `status_mode`; PATCH ~164; Client `startedUnderCleanup` ~3556–3559; `cleanupStarted` erlaubt pending; `bestE1rm` ~2956–2961.
- **Why new:** Heute gefixt: Hard-Delete untracked Sessions mit Sets und close-PATCH Orphans. Stamp-Prädikat vs. Finish war nicht Teil davon.
- **Suggestion:** `status_mode_since` laden; `is_cleanup` nur wenn Cleanup gestartet (`calendarDaysSince(since) >= 0`) **und** `session.started_at >= status_mode_since` (null `started_at`: nicht stamp’en). Pending Cleanup: false.

### [logic] Drop / Myo / AMRAP Sheets noch im Total-kg-Raum für plus_load

- **File:** `src/screens-train.jsx`
- **Domain/Angle:** train-logic-residual
- **Issue:** Haupt-Set-UI für plus_load zeigt/edits Belt Load (`dispWeight`/`weightPatch`). Intensity-Chains seed’en `kg: s?.kg` (Stored Total), rendern/editieren diesen Total in KbCells/`activate*Kb`, finish via `totalToPatch`. User mit +10 Belt sieht ~bw+10 im Sheet und korrumpiert Total/`addedKg` bei Retype-as-belt. `isBodyweight` ist `equipment === 'bodyweight'` inkl. plus_load → Finish-Filter akzeptieren null kg.
- **Evidence:** startDrop/startAv/startMyo ~8011–8046; activateDropKb ~4717–4720; kbApply ~4809–4842; finish*Set ~1959–2138; Main activateKb ~4697–4702 (fixierter Pfad).
- **Why new:** Main-Set-Keyboard war gefixt; Chain-UI blieb bewusst/implizit auf Total-Space und divergiert vom Row-Contract.
- **Suggestion:** Chain kg mit `dispWeight`/`weightPatch` seed’en und schreiben, oder Totals explizit labeln und nur on finish konvertieren; plus_load in Finish-Filtern wie weighted (kg required).

### [logic] Cleanup/Deload reduzieren plus_load-Seeds nicht

- **File:** `src/store.js`, Session-Start: `src/screens-home.jsx` / `src/screens-schedule.jsx`
- **Domain/Angle:** train-logic-residual
- **Issue:** `cleanupAppliesToExercise` returnt false für **alles** `equipment === 'bodyweight'`. Session-Start übergibt `bodyweightKg` für jedes BW-Exercise → Deload/Cleanup in `buildSeedSets` aus. `withPlusLoad` schreibt danach full `BW+prevAdded`. Cleanup/Deload-Wochen seed’en volle Belt Load, kein Full/Reduced-Chip, PR-Suppression denkt „nie reduziert“.
- **Evidence:** `cleanupAppliesToExercise` ~3291; deload/cleanup Require `bodyweightKg==null` ~3333–3338; Home/Schedule pass `latestBodyweight` für BW; Tests asserten BW exempt ohne plus_load-Cleanup-Case.
- **Why new:** Cleanup Anti-Compounding für Bar Loads war designed/getestet; plus_load nie in den Contract gefaltet.
- **Suggestion:** Nur pure BW-Modes (null/pull) exempten, nicht plus_load; `bodyweightKg` nur via `shouldPullBodyweight`; Cleanup/Deload-Faktor auf Belt Load in `withPlusLoad`.

### [data-integrity] Copy/Move behält `planned` bei planMode off und kann Macros nullen

- **File:** `src/screens-food.jsx`
- **Domain/Angle:** food-units-plan
- **Issue:** `submitCopyMove` setzt `planned: targetLandsPlanned ? true : l.planned`. Wenn `targetLandsPlanned` false (planMode off oder Past Day), bleiben Source-`planned:true` Rows planned. Verletzt die Datei-Invariante (planMode off → keine planned Rows). `!targetLandsPlanned` triggert trotzdem `patchDaily` + Manual-Macro-Warn; planned-only Clone-Batch kann Health-Macros nullen, nachdem der User einen Overwrite bestätigt hat, den er nie als logged Food bekommt.
- **Evidence:** ~2969–2994 vs. `submitRepeatYesterday` `planned = planMode`; `patchDaily` summiert nur `!planned`.
- **Why new:** Investor deckte Plan-it-Gating und Coach-Plan-Notes ab, nicht Copy/Move-Reintro planned nach planMode off.
- **Suggestion:** `planned: !!targetLandsPlanned` (bei !planMode immer false). `patchDaily` nur wenn mindestens ein `!planned` Clone landet. Align mit `confirmRecipeLog` `wantPlanned = planned && planMode`.

### [logic] Shopping Inventory Labels „(g)“ bei oz-Input-Pipeline

- **File:** `src/screens-food.jsx` (+ `UI.massInOz` / `fdMassFilter` / `fdMassG`)
- **Domain/Angle:** food-units-plan
- **Issue:** „+ grams“ und „Warn when below (g)“ hardcoden Gramm-Labels, lesen/schreiben aber über `fdMassFilter`/`fdMassG`, die bei `unit===lbs` und ohne Force-Grams **Ounces** interpretieren. Imperial-User tippen 150 „als Gramm“ → ~150 oz (~4252 g). Stock/Threshold ~28× schief. Package size und no-package Update stock nutzen korrekt `UI.massEntryUnit()`.
- **Evidence:** Labels ~8405, ~8425 vs. korrekte Nachbarn ~8370, ~8411; Save ~7841, ~7885 via `fdMassG`.
- **Why new:** Kein prior Finding zu Shopping-Pref Stock/Threshold Mislabel; Force-Grams hat die hardcoded (g) Labels nicht gefixt.
- **Suggestion:** Beide Felder mit `UI.massEntryUnit()` labeln; mass-aware Placeholders; Conversion behalten. Optional `FdUnitToggle` pro Sheet.

### [edge] medication-reminder rematerialisiert gelöschte Doses

- **File:** `supabase/functions/medication-reminder/index.ts`, Client: `src/screens-medications.jsx`
- **Domain/Angle:** health-meds-cardio
- **Issue:** `materializeDueDoses` inserted stündlich fehlende planned Rows für due Slots. Client `deleteLogEntry` hard-deleted die Timeline-Row (inkl. bewusster Skips). Nächster Cron tick recreatet `md_${date}_${slotId}` als `planned:true` und kann erneut nudgen. Kein Skip/Suppress/Tombstone.
- **Evidence:** materialize existing Set nur date+slot; insert planned:true; Client delete by id; `mdAutoFillToday` Kommentare: delete allein re-triggert Client-Fill nicht, schützt aber nicht vor Server-Rematerialize.
- **Why new:** Investor: auto-close Sessions und Coaching Sync Notes; Meds Cron vs. Client-Delete nicht auf Denylist.
- **Suggestion:** Intentional absence suppressible machen (soft-skip, Tombstone, oder Rematerialize stoppen solange Slot/Plan unverändert und User deleted today).

### [data-integrity] materializeDueDoses: merge-duplicates kann taken Dose reöffnen

- **File:** `supabase/functions/medication-reminder/index.ts`
- **Domain/Angle:** edge-ai-cron
- **Issue:** Nach non-atomic SELECT POSTet materialize mit `Prefer: resolution=merge-duplicates` und Payload `planned:true`, `dose_qty: slot.dose_qty` auf deterministischem PK `md_<date>_<slotId>`. Client kann parallel `planned:false` geschrieben haben; Cron-Merge reöffnet Dose, resettet qty, re-enabled Nudges, verwirft Stock-Consumption.
- **Evidence:** ~151–192 Prefer merge-duplicates; Client gleiche ID-Konvention; kein ignore-duplicates, kein planned-false Guard.
- **Why new:** Meds-Arbeit deckte Schedule/Nudge-Bookkeeping ab, nicht Server-Materialize-Clobber einer just-taken Dose.
- **Suggestion:** `resolution=ignore-duplicates` oder RPC `ON CONFLICT DO NOTHING`; nie Full planned Rows mergen. Optional re-SELECT vor Nudge-Selection.

### [data-integrity] submitCheckin wechselt Primary Key bei jedem Upsert

- **File:** `src/store.js`, Consumer: `ai-checkin-opinion`, `src/screens-coaching-tabs.jsx`
- **Domain/Angle:** coaching-isolation
- **Issue:** Jeder Submit minted `id = 'ci_'+…` neu, auch bei Edit. `onConflict: 'coaching_id,week_start'` → PostgREST UPDATE schreibt die PK um. `isEdit` ändert nur Note-Text-Prefix, reuses nie `existing.id`. `ai-checkin-opinion` claimt/PATCHt strikt `id=eq.checkinId` → false 409, fehlender Save nach Generate, oder stuck Row mit `ai_opinion_generated_at` ohne `ai_opinion`.
- **Evidence:** `submitCheckin` ~5542–5586; Tabs pass `!!existing` nicht `existing.id`; Edge claim/PATCH id-only.
- **Why new:** Investor deckte Check-in PK-Churn und AI-Claim-Interaktion nicht ab; anderer Root Cause als server-authored `ai_opinion` selbst.
- **Suggestion:** On edit existing id reuse (oder id aus Conflict-UPDATE weglassen). PK nach Insert nie mehr ändern.

### [sync-race] reloadCoachingState map’t Errors auf leere Relationships

- **File:** `src/store.js`, Caller: `src/app.jsx`, Coaching/Settings Screens
- **Domain/Angle:** coaching-isolation
- **Issue:** `reloadCoachingState` prüft `coachClientsRes`/`coachInfoRes`/`unreadRes.error` nicht. Soft Failure → `data=null` → `asCoach:[]` / `asClient:null` / `unreadNotes:[]`. Caller ersetzen `store.coaching` wholesale (Realtime-Path `.catch` fängt nur throws). Coach-Roster und Client-Link verschwinden bis zum nächsten erfolgreichen Reload. Boot `loadFromSupabase` throw’t korrekt auf denselben Errors.
- **Evidence:** ~5247–5283 kein Error-Check; app.jsx ~1505–1517 wholesale replace; Boot ~1368–1370 throws.
- **Why new:** Nicht der Plan-Note-Flush-Fix; Relationship-State-Wipe bei Transient Errors.
- **Suggestion:** Boot spiegeln: throw (oder prev behalten) wenn irgendeine Coaching-Query errored; Error nie als empty Relationships behandeln.

### [sync-race] Home Recap / Stats Hydrate ohne Merge-Bail → Endlos-Loop

- **File:** `src/screens-home.jsx`, Stats: `src/screens-lib.jsx`
- **Domain/Angle:** home-lib-windowing
- **Issue:** Home Recap prior-session Hydrate ruft immer `setStore` mit frischem `sessions`-Array und bailed nie, wenn `fetchSessionEntries` keine Rows liefert. `neededPriorSessionIds` aus Memo über `store.sessions` → bei windowed Session (`aggExercises>0`, empty entries, zero server rows) re-arm forever. Stats `thisPeriodSessions` gleiches always-setStore. Library Recent und SessionDetail haben bereits `merged ? … : st`.
- **Evidence:** Home ~1785–1798 always map setStore; neededIds ~1748–1756; `fetchSessionEntries` omittiert ids ohne Entry-Rows; Recent/Detail Bail ~343–350 / ~3842–3849.
- **Why new:** Investor fixte Library Recent empty-lie und dessen Re-Arm; Home/Stats noch im Pre-Bail-Idiom.
- **Suggestion:** Recent/prevNeedIds Guard kopieren (`bySession[id]?.length`, setStore nur wenn merged). Need-Id-Deps als sorted joined string stabilisieren.

### [a11y] Shared `Toggle` ohne Rolle, Fokus, Keyboard

- **File:** `src/ui.jsx`
- **Domain/Angle:** shell-sw-a11y
- **Issue:** `Toggle` ist ein klickbares `div`: kein `role="switch"`, kein `aria-checked`, kein `tabIndex`/`button`, kein Space/Enter. Fast alle Settings- und Onboarding-Switches sind für Keyboard/Screenreader unerreichbar oder stumm. Repo-weit zero `role="switch"` / `aria-checked`.
- **Evidence:** `ui.jsx` ~778–783; Call sites Settings/Health/Meds/Food/Schedule/Lib/Coaching.
- **Why new:** Investor war Product/Data-Trust; shared Switch Primitive und Settings-a11y-Surface nicht auditiert.
- **Suggestion:** `<button type="button" role="switch" aria-checked={on} disabled={…}>` mit Space/Enter; Labels via `aria-labelledby` oder Wrapping.

---

## Medium

### [logic] Medications Timeline friert lokales Datum über Mitternacht

- **File:** `src/screens-medications.jsx`
- **Domain/Angle:** health-meds-cardio
- **Issue:** Kein Date-Ticker / kein `prevTodayRef`-Follow für `curDate` (im Gegensatz zu Water/Food). Overnight-open Session freest `today`/`curDate`; `saveLogDraft` stamp’t `date: curDate` → Post-Midnight-Logs auf dem Vortag.
- **Evidence:** `today = LB.todayISO()` nur pro Render; `useStateMd(today)` ohne Midnight-Follow; Water/Food 30s + visibility Tick.
- **Why new:** Nicht die denylisted empty-state CTA; Calendar-Freeze und wrong-day Stamp.
- **Suggestion:** Food/Water spiegeln: stateful today + 30s/visibility; `setCurDate(d => d === prevToday ? today : d)` on rollover.
- **Severity note:** Medium, weil Niche-Pfad (Screen offen über Mitternacht); Remount/Nav resettet oft.

### [bug] App-SW SWR cached Public-Marketing-HTML

- **File:** `sw.js` (Annahmen: `tools/check-cache-version.cjs`, Docs)
- **Domain/Angle:** shell-sw-a11y
- **Issue:** Same-Origin-Branch macht SWR + `cache.put` für **alle** same-origin GETs (außer `?_v=`). `welcome.html` / `features.html` / `autoreg.html` sind nicht in `ASSETS`, werden aber runtime-cached sobald der App-SW die Origin kontrolliert. Docs und `check-cache-version` behandeln sie als „außerhalb SW“ und pinnen nur Script-`?v=`; HTML (und damit embedded `?v=`) kann stale aus Cache Storage kommen.
- **Evidence:** fetch handler ~181–233; `clients.claim` on activate; Public pages registrieren keinen eigenen SW.
- **Why new:** Investor deckte SW-Scope vs. Public-Page-Annahmen nicht ab.
- **Suggestion:** Network-only (kein `cache.put`) für Public Marketing Routes; SWR nur App-Shell/ASSETS. Docs: `?v=` allein schlägt SW-HTML-Cache für Returning App Users nicht.

### [logic] Cleanup-Fenster wird bei Plan-/Mode-Wechsel nicht re-gepinnt

- **File:** `src/screens-schedule.jsx`, Länge/Elapsed: `src/store.js`
- **Domain/Angle:** schedule-cleanup
- **Issue:** Cleanup-Start (`statusModeSince` via `nextCleanupStartISO`) ist am Start eingefroren; Länge/Elapsed lesen live den **aktuellen** active Plan (`deloadPlanDays` / Flex Session Goal). Activate setzt nur Plan-Position-Scalars; Flex-Save nur `cycleStartDate`; `switchMode` draft-only. Plan-Wechsel, cycle↔weekday oder Flex-Toggle während pending/running Cleanup → Start aus altem Plan, Dauer aus neuem → Overlay endet früh, läuft lang, oder startet mid-rotation.
- **Evidence:** `startCleanupWithPct` ~162–171; `nextCleanupStartISO`/`deloadPlanDays`/`cleanupElapsed` activeScheduleId-resolved; `activate` ~889–907.
- **Why new:** Investor fixte Boot-Merge der weekPlanStartDate/statusMode-Scalars, nicht Live-Re-Alignment des Cleanup-Overlays.
- **Suggestion:** Bei `activeScheduleId`- oder Plan-Mode/Flex/Day-Count-Change und `statusMode==='cleanup'`: pending → `nextCleanupStartISO` neu + `updateStatusPeriodStart`; running → confirm end/restart oder remaining gegen neuen Plan + UI-Hinweis.
- **Severity note:** Medium; braucht concurrent Cleanup + Plan-Change; multi-step Edge.

### [sync-race] Inverse Status-Period: Remote-Close, lokaler Open + Mode-Reassert

- **File:** `src/app.jsx`, Merge: `src/store.js`
- **Domain/Angle:** sync-data-integrity
- **Issue:** Residuum des open-period `mergeBootScalars`-Fixes. Anderes Gerät schließt Period; dieses Gerät hält local open (`mergeCollectionById`: cur ≠ base), Merge forciert `statusMode` aus open Period, `syncStore` gated-write’t `status_mode` zurück. `statusPeriods` sind nicht im syncStore-Diff → Server-closed Period wird nicht repariert. Sauberer Multi-Device-Pfad (base present, local unverändert) nimmt Server closed korrekt; Reassert braucht Local-Divergenz / no-base localWins / Open-Override ohne Closed-Clear.
- **Evidence:** `mergeCollectionById` keep cur if c&&b&&c!==b; open override forces mode; tests decken remote-close + local open diverge nicht ab.
- **Why new:** Open-Period-Override gefixt; inverse Race residual und ungetestet.
- **Suggestion:** Wenn fresh `endedAt` hat und base/cur noch open: Server-Period wins (remote close), außer dieses Gerät closed/edited after base. Period-Close und statusMode-Clear ideal transactional; optional re-fetch periods after mode merge.

### [edge] Water- und Daily-Log-Reminder stamp’en Throttle ohne `res.ok`

- **File:** `supabase/functions/water-reminder/index.ts`, `daily-log-reminder/index.ts`
- **Domain/Angle:** edge-ai-cron
- **Issue:** Throttle-PATCH (`water_last_push_at` / `daily_log_reminder_last_date`) nur `.catch` auf Network Reject. HTTP non-2xx wird nicht geprüft (`fetch` wirft nicht). Fehlgeschlagener Stamp lässt COOLDOWN/Daily-Gate offen → Re-Nudge alle `*/15`, solange User noch qualifiziert. Medication-reminder hat state-first + `rollbackRes.ok`.
- **Evidence:** water-reminder ~128–132 PATCH + `.catch` only; Reads prüfen `r.ok`; Gate ~76 COOLDOWN 1h.
- **Why new:** Med-Reminder state-first+rollback; Water/Daily-Log noch fire-then-best-effort ohne HTTP Status.
- **Suggestion:** `patchRes.ok` prüfen; bei Failure Send nicht als done zählen oder Stamp retry. Prefer stamp-before-send mit Rollback, oder conditional PATCH wenn last_push noch alt.
- **Severity note:** Medium: Push-Spam bei Throttle-Write-Failure, kein Data Corruption.

### [ci-docs] CI prüft SOURCES, nicht ASSETS-Parität

- **File:** `tools/check-syntax.cjs`, `sw.js` ASSETS, `index.html` SOURCES
- **Domain/Angle:** incomplete-ci-docs
- **Issue:** JSX-SOURCES werden aus `index.html` geparst; `plainSources` hardcodiert; **kein** Gate vergleicht mit `sw.js` ASSETS oder parse’t `<script src>` vs. plainSources. CLAUDE verlangt dual Registration; vergessener ASSETS-Eintrag bleibt green → offline Precache/first-open-without-network bricht für das Modul, online SWR kann maskieren.
- **Evidence:** check-syntax ~18–30; sechs CI-Gates; aktuell SOURCES und ASSETS matchen (kein Live-Fail).
- **Why new:** Nicht Denylist; prior Work war Product UX, nicht Loader/SW-Registration-CI.
- **Suggestion:** Gate: jeder SOURCES-Eintrag in ASSETS; jedes non-vendored `src/*` script in plainSources; Fail on Drift.
- **Severity note:** Medium: latent für nächstes neues Modul, offline-only impact.

---

## Low

*Keine.*

---

## Priorisierte Fix-Reihenfolge (Top 8)

1. **plus_load Seed-Pipeline (`addedKg`)** – stiller Datenverlust bei jedem neuen Session-Start für plus_load-User; blockiert Progression/Cleanup-Vertrauen.
2. **Intensity-Technique Chain Space (Drop/Myo/AV)** – korrumpiert Totals/`addedKg` direkt nach dem gefixten Main-Keyboard; gleicher User-Pfad.
3. **Daily-Log Adherence `updatedAt` Stomp** – Multi-Device Full-Row-Clobber von Weight/Steps/Macros/Notes/Coach-Fields.
4. **Meds materialize: ignore-duplicates + Delete-Tombstone** – taken Dose reöffnen und Skip-Nudges in einem Cluster; hoher Cron-Impact.
5. **submitCheckin PK stabil halten** – AI-Opinion Race (409/502/stuck), Edit-Identity.
6. **auto-close `is_cleanup` Prädikat** – PR-Baselines und Cleanup-Historie still verfälscht.
7. **reloadCoachingState Error-Handling** – Coach-Roster verschwindet bei Transient Network/RPC.
8. **Grant-Drift `authenticated_exec` (+ ideal Default-Privileges Fix)** – Klasse service-role-only RPCs bleibt ohne Automation regressierbar.

*Parallel/günstig danach:* Copy/Move `planned`, Shopping Labels, Toggle a11y, Home/Stats Hydrate Bail, plus_load Cleanup/Deload Apply.

---

## Residual Risk

| Kategorie | Status |
|---|---|
| Rejected Findings | 5 (nicht haltbar, denylist-overlap, oder reine Produkt-Gaps ohne neuen technischen Root Cause) |
| Interne Duplikate collabsiert | 2 Scan-Items → 1 High (auto-close `is_cleanup` aus train-logic + schedule-cleanup) |
| Unverified | 0 |
| Failed Scan Domains | 0 (11/11 ok) |
| Bekannte Degradationen (akzeptiert/separat) | History-Windowing-Semantik wie in `docs/internals.md`; Public Pages bewusst nicht in ASSETS |
| Test-Lücken, die False Greens erzeugen | plus_load Tests hand-build `last` mit `addedKg` (umgehen `bestEntryFromSetLists`); Status-Period-Tests ohne remote-close + local open diverge |
| Nicht erneut geöffnete Investor-Items | Denylist vollständig respektiert; bei Bedarf nur als Kontext, nicht als open Bugs |

**Gesamtrisiko nach Audit-Day:** Kein Critical, aber **mehrere High im Trainings-Datenpfad (plus_load Cluster)** und **Multi-Device Daily-Log LWW** sind ship-relevant. Meds-Cron (Rematerialize + merge-duplicates) und Check-in-PK sind die schärfsten Edge/Coaching-Risiken. CI/Grant- und a11y-Findings sind latent bzw. compliance-relevant, aber kein unmittelbarer Datenverlust.
