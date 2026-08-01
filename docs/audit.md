# Deep Audit: Logbook / Zane

**Stand:** 2026-07-31  
**Methode:** Workflow `deep-audit` (12 Domain-Scans + 4 Cross-Cutting + 18 adversarische Verifications + Synthese)  
**Rohfunde:** 174 · **Verified (Code-Pfad bestätigt):** 18 · **Critical:** 0  
**Scope:** Read-only. Keine Fixes in diesem Durchlauf.  
**Auswertung:** Findings gegen `Claude.md`, `docs/database.md`, `docs/internals.md` und die bekannten Contracts (History-Windowing, AI server-authored, SW-Cache-Policy, Backup-Allowlists, Sync/`unwrap`).

---

## 0. Projektregeln-Filter (Claude.md)

Nicht alles, was „komisch“ aussieht, ist ein Bug. Diese Auswertung stuft ab:

| Thema | Contract | Audit-Umgang |
|-------|----------|--------------|
| History-Windowing (`entries: []` außerhalb ~70 Tage, Aggregate) | Intentional (`docs/internals.md`, Boot lädt konstant viele Sets) | **Kein Bug.** Bug ist nur, wenn UI all-time-Claims macht ohne `exerciseBests` / Nachladen (H9, Home ↑/↓). |
| AI-Felder (`ai_summary*`, `ai_opinion*`) außerhalb Client-Sync | Intentional (Migration 0224/0225, Edge schreibt, Sync-Spaltenliste lässt sie weg) | **Kein Sync-Bug.** Bug ist lokales Droppen im UI-Save und Hard-Delete von AI-only Days (H11). |
| SW-Cache-Bump nur auf Ansage | Intentional (`Claude.md` Deployment) | **Kein Deploy-Bug.** Stale nach Code-Deploy ohne Bump ist Policy. CI `check-cache-version` deckt Public-`?v=` ab. |
| Pillbox-Checks / Plan-Drafts / Feature-Map / API-Usage nicht im Backup | Intentional oder Admin-only | **Kein Backup-Bug**, sofern Restore-UX nicht lügt. |
| `sys_`-Ids nie in Plänen/Sessions | Contract: immer User-Kopie | Primärpfade laut Audit gesund; nur echte Leaks wären P0. |
| Radius 4/6/8/999, Accent via `--accent-rgb`, `UI.unit()` | Design-Contract | Verstöße = Design-Debt, nicht Data-Loss. |
| Settings an 4 Stellen in `store.js` | Pflicht bei neuen Settings | Fehlt Import/Backup → CI `check-backup-coverage` sollte greifen. |
| Grant-Fallen SECURITY DEFINER | `REVOKE PUBLIC` + authenticated-DEFAULT noch offen | Bleibt **P1 Security/Housekeeping** (Claude.md dokumentiert Root Cause). |
| Em-Dashes | Verboten in App/Doku/Chat | Dieser Report enthält keine. |

**Kurz:** Die härtesten verified Findings (Multi-Device Session-Kill, Favoriten-Sync-Block, Support-Wipe bei Invite-Accept, Cron ohne Auth) stehen **nicht** im Widerspruch zu den Contracts. Sie sind echte Lücken im erlaubten Design.

---

## 1. Executive Summary

Die App ist architektonisch reif: RLS, `unwrap`/Retry, History-Windowing, Staleness-Guards auf Sets/Daily/Meso, Recipe-Share, Plan-Drafts und die Tracker-Familien (Water/Food/Meds) sind bewusst gebaut. Das Produkt fühlt sich nicht „halb“ an.

**Was Nutzer am härtesten trifft (Datenverlust und Vertrauensbruch):**

1. **Multi-Device Training-Kill:** Lokales `inProgress = null` überschreibt den Server-Pointer; Orphan-Delete + CASCADE löschen offene Sessions inkl. Sets. Verstärkt durch Auto-Close (ungesyncte Sets, fehlende Settings-Zeile → Delete).
2. **Food-Favoriten blockieren den gesamten Sync:** Edge-`cache` meldet immer 200, dangling `food_id` ohne 23503-Fallback, `flushSync` hängt im Retry.
3. **Coaching-Accept löscht Support-Tickets:** `respond_to_coaching_invite` ohne `support_%`-Guard (im Gegensatz zu `invite_client` / Migration 0151).
4. **Falsche PR- und Improvement-Signale** nach ~70 Tagen / nach Deload (SessionDetail `prMap`, Home-cmp). Windowing selbst ist ok; die Anzeige-Logik verletzt den all-time-Contract (`exerciseBests` / `LB.isImprovement`).
5. **AI-Tages-Summary lokal weg** nach Health-Form-Save; Regen → 409. Server-Spalte bleibt oft, UI-State und Flex-Rest-Delete sind das Problem.
6. **Dose-Reminder feuern nicht**, solange der Meds-Tab an dem Tag nicht geöffnet wird (Materialize nur on mount).
7. **Cron-Jobs mit öffentlichem Anon-JWT** triggerbar (Push-Spam, Session-Mutation).

**Top-Risiken jenseits Screen-Bugs:**
- Security: Cron ohne Caller-Gate, YouTube-`href` ggf. unguarded im Train-UI, AI-Spalten nur auf UPDATE geschützt, Coach-Write auf breite Settings/Meds, DEFAULT PRIVILEGES für `authenticated` noch offen.
- Offline: Glucose/BP/Temp und Status-Periods ohne `syncStore`-Queue.
- Deploy: Ohne CACHE-Bump bleibt der erste Reload stale (**Policy**, kein CI-Fail).

---

## 2. Stats

| Severity | Count (≈) | Davon verified |
|----------|-----------|----------------|
| Critical | 0 | 0 |
| High | 24 | 15 |
| Medium | 85 | 2 |
| Low | 40 | 1 |
| Info | 25 | 0 |
| **Summe** | **~174** | **18 verified** |

Hinweise: Einige High-Themen erscheinen in Domain- und Security-Audits doppelt (Cron, Pushover-Key, DEFAULT PRIVILEGES). Unten einmal priorisiert. Unverified High/Medium sind klar markiert. Severity von Verifiern teilweise heruntergestuft (z.B. asClient multi-pending, Accept-Modal).

---

## 3. Critical und High (verified first)

### 3.1 Datenintegrität Training / Multi-Device (verified)

#### H1. Multi-Device: `inProgress=null` killt laufende Session inkl. Sets
**Area:** store-app · **Severity:** high · **Verified:** ja

Beim Cache-first-Boot gewinnt lokales `inProgress` immer, auch wenn es `null` ist und der Server eine offene Session meldet. Der Flush schreibt `in_progress_session_id: null` unconditional (anders als gated Plan-Position-Felder). `loadFromSupabase` löscht danach jede `ended=null`-Session, die nicht dem Pointer entspricht; Entries/Sets hängen per ON DELETE CASCADE.

**Evidenz:** `src/app.jsx` (Merge mit `'inProgress' in cur`, syncBase=fresh), `src/store.js` Settings-Upsert + Orphan-Delete ~1340–1348, `schema.sql` CASCADE.

**Impact:** Phone trainiert, Desktop öffnet App → Workout inkl. geloggter Sätze weg.

**Fix-Richtung (nicht umgesetzt):**
1. `inProgress` base-aware wie `PLAN_POS_FIELDS` (cur nur wenn ≠ base).
2. `in_progress_session_id` im Settings-Upsert nur bei echter Änderung mitschreiben.
3. Orphan-Cleanup: offene Sessions mit Sets nicht hard-deleten (auto-close-style enden oder bis Timeout stehen lassen).

#### H2. Top-Level-Skalare ohne base-aware Boot-Merge
**Area:** store-app · **Severity:** high · **Verified:** ja

`weekPlanStartDate`, `activeCardioPlanId`, `customDayTypes`, `statusMode`, `statusModeSince`, `deloadPromptDismissedAt` kommen nur über `...fresh`. Offline-Edits gehen beim Background-Refresh verloren. Zusätzlich schreiben `status_*` / Cardio / Day-Types bei jedem Settings-Upsert unconditional.

**Fix-Richtung:** Dieselben Keep-cur-if-unsynced-Regeln + gated Upsert-Felder wie bei Plan-Pos.

#### H3. Auto-Close + `mergeSessions` verwerfen ungesyncte Sets; Client kann Session wieder öffnen
**Area:** train-schedule · **Severity:** high · **Verified:** ja

Cron endet Session nach letzter *gesyncter* Set-Aktivität und cleared den Pointer. Merge setzt `isActive` nur bei `ended == null`; `mergeEntrySets` übernimmt nur technique/drops, nicht kg/reps/done/timeSec. Umgekehrt kann `sessionToRow` mit lokalem `ended: null` eine serverseitig geschlossene Session wieder öffnen.

**Fix-Richtung:** Solange lokales inProgress die Session meint: lokale Entries/LWW-per-set autoritativ; vor Accept von server-`ended` pending Sets flushen; `ended` nicht blind clearen; TrainScreen bei Auto-Close freezen.

#### H4. Auto-Close löscht Sessions wenn Settings-Zeile fehlt
**Area:** edge-functions · **Severity:** high · **Verified:** ja

`isTracked = sett?.in_progress_session_id === sess.id` ohne `settRes.ok`. Fehlende Settings → „orphan“ → DELETE sets/entries/session.

**Fix-Richtung:** Bei `!settRes.ok` oder `!sett`: continue/skip, nie delete. Analog `setsRes` absichern.

---

### 3.2 Food Sync-Blockade (verified)

#### H5. `cacheFood` antwortet immer 200 → dangling Favorite-FKs
**Area:** food · **Severity:** high · **Verified:** ja

Edge `action: 'cache'` liefert immer `{ ok: true }`, auch wenn kein `zane_foods`-Row geschrieben wurde. Client (`ensureFoodCached` / Star / Repair) vertraut `res.ok`.

#### H6. Favorites ohne 23503-Fallback blockieren `syncBase` für immer
**Area:** food · **Severity:** high · **Verified:** ja

Food-Logs heilen FK-Fehler per Null-`food_id`; Favorites nicht. Ein kaputter Favorite hält den ganzen Account im not-synced-Retry.

**Fix-Richtung (H5+H6):** Truthful cache-Response; `ensureFoodCached` verlangt echten Cache-Hit; `foodFavoriteUpsertWithFkFallback`; Repair nur nach nachgewiesenem Hit markieren; unheilbare Favorites `foodId` nullen.

**Bezug Claude.md:** Food-Favorites-localStorage-Repair-Keys sind bewusst per Gerät; das verhindert hier nicht den globalen Sync-Stall über `flushSync`.

---

### 3.3 Coaching Datenverlust (verified)

#### H7. Accept Invite hard-deletes alle Support-Tickets des Users
**Area:** coaching · **Severity:** high · **Verified:** ja

`respond_to_coaching_invite` löscht alle active `zane_coaching` rows des Clients außer der Invite-Id, **ohne** `id NOT LIKE 'support_%'`. Support-Tickets sind `status='active'`, Notes/Threads CASCADE.

**Fix-Richtung:** Migration analog 0151/`invite_client`; `schema.sql` + `docs/database.md`; optional Prod-Check/Recovery.

#### H8. Self-Coaching „Myself“ = zweiter Store für dieselbe `userId`
**Area:** coaching · **Severity:** high · **Verified:** ja

`loadClientStore` + `useCoachClientSync` vs. Main-Store `flushSync`. MultiView keep-alive refreshed Snapshot nicht. Plan-Activate/Edit können Train/Plan und Coaching auseinanderlaufen.

**Fix-Richtung:** Bei `isSelf` an `store`/`setStore` binden, `loadClientStore` skippen, normale Plan-Pfade nutzen.

---

### 3.4 Falsche Progress-Signale (verified)

#### H9. SessionDetail-PR-Badges nur In-Window-Entries
**Area:** home-lib · **Severity:** high · **Verified:** ja

`prMap` scannt nur `sessions[*].entries`; Windowed Sessions haben `entries:[]`. `exerciseBests` wird geladen, hier nicht genutzt → False-PRs nach ~70 Tagen.

**Contract-Note:** Windowing ist richtig. Live-Train nutzt `bestE1rmForExercise` (Server-Aggregat + Fenster). SessionDetail bricht diesen Contract.

**Fix-Richtung:** Seed/Prior-Fetch as-of `s.ended` (nicht naiv all-time für alte Recaps); Live-Train-Pfad als Vorbild.

#### H10. Home ↑/↓: kg-only cmp, Deload-Priors inklusive
**Area:** home-lib · **Severity:** high · **Verified:** ja

Private `cmp` vs. `LB.isImprovement`; Deload nicht gefiltert. Nach Deload-Woche übertriebene ↑ auf der Complete-Card.

**Contract-Note:** `isImprovement`/`isDecline` sind geteilte Top-Level-`const` in `screens-lib.jsx` (Scope-Regel Claude.md). Home soll dieselben Helpers nutzen, nicht eine Parallel-Implementierung.

**Fix-Richtung:** `!isDeload` + `LB.isImprovement`/`isDecline`.

---

### 3.5 Health AI / Meds Reminder (verified)

#### H11. Daily-Log-Save und Flex-Rest droppen AI-Summary
**Area:** health-water-cardio · **Severity:** high · **Verified:** ja

`DailyLogScreen.save` baut den Tag neu ohne `aiSummary*`. Card zeigt Generate; Edge 409. `hasLogContent` ignoriert AI → Flex Rest kann Row hard-deleten inkl. Server-Summary.

**Contract-Note:** Server-authored AI (nicht in `sync_daily_logs_batch`) ist Absicht. Client darf die Felder lokal nicht droppen und die Zeile nicht löschen, nur weil das Formular sie nicht kennt.

**Fix-Richtung:** AI-Felder preserven; `hasLogContent` erweitern.

#### H12. Dose-Reminder brauchen Meds-Screen-Mount
**Area:** medications · **Severity:** high · **Verified:** ja

`mdAutoFillToday` nur im Mount-Effect; Cron liest nur `planned=true` Logs. Settings-Copy verspricht Nudges ohne Tab-Voraussetzung.

**Fix-Richtung:** Server-side Derive aus active plans+slots, oder Auto-Fill on boot wenn `medsEnabled`.

---

### 3.6 UI / Security Edge (verified)

#### H13. Time-Set-Countdown-Chrome unlesbar auf Light/Paper
**Area:** ui-theme · **Severity:** high · **Verified:** ja

Forced dark scrim + themed `UI.inkSoft` / `.micro-gold` → dark-on-dark. Ziffern ok (`--accent-raw`).

**Contract-Note:** Light/Paper drehen Ink dunkel (`Claude.md` Theme). Forced-dark Surfaces brauchen eigene light chrome, nicht Theme-Tokens.

**Fix-Richtung:** Immersive light chrome hardcoden; keine Theme-Ink-Tokens auf forced-dark Scrims.

#### H14. Cron Edge Functions mit public Anon-JWT triggerbar
**Area:** edge-functions / security · **Severity:** high · **Verified:** ja

reminder, water/meal/medication-reminder, auto-close-sessions: Service-Role-Arbeit, kein Caller-Check. pg_cron schickt Anon-Bearer (Client-sichtbar).

**Impact:** Push-Spam, Session-Close/Delete-Läufe, API-Kosten. Kein Cross-Tenant-Response-Leak, aber Missbrauch/DoS.

**Fix-Richtung:** `CRON_SECRET` oder Service-Role-Auth in jeder Function; Cron-Header rotieren; Anon ablehnen.

#### H15. Hardcoded Pushover User-Key-Fallback
**Area:** edge-functions · **Severity:** high · **Verified:** ja

Literal Key im Repo bei leerem `userKey` (interner Pfad).

**Fix-Richtung:** Fallback entfernen; skip/400 ohne Key. Key rotieren, falls live genutzt.

---

### 3.7 Weitere High (unverified, aber stark)

| Titel | Area | Kurz | Claude.md-Note |
|-------|------|------|----------------|
| AI-Spalten-Guard nur UPDATE; INSERT kann faken | database | Coach-sichtbare Fake-Opinions; once-per-day Gate poisonable. **BEFORE INSERT** force null. | Passt zu „server-authored only“. |
| `authenticated` DEFAULT PRIVILEGES Root Cause offen | database | Nächste service-only SECURITY DEFINER leakt EXECUTE; CI sieht nur anon. | Explizit in Claude.md (Migration 0132/0208). |
| Coach UPDATE auf gesamte Client-Settings-Row | database | Weit über Plan-Activation; VIP-Cosmetics, Reminders, Macros. | Coach-of-client RLS prüfen, Scope verengen. |
| Deploy ohne CACHE-Bump: erster Reload stale | pwa-public | SWR + Banner nur bei CACHE-String. | **Policy, kein Bug.** Nur bei bewusstem Bump. |
| `youtube_url` im Train-UI ohne Sanitize | security | Coach-writable + raw `href` → `javascript:` möglich. | Library-Pfad nutzt `sanitizeYoutubeUrl`; Train ggf. nicht. |
| Home-Cancel räumt Meso-Cache nicht | ux-traps | Compound-Deltas nach Cancel+Restart. | Unverified, aber klarer UX-Pfad. |
| Glucose/BP/Temp nicht im `syncStore` | gaps-unify | Offline-Verlust trotz Offline-Claim. | Water/Food sind im Store; Vitals asymmetrisch. |

---

## 4. Medium Findings (nach Area)

### store-app *(unverified)*
- **startDeload/endDeload/clearStatusMode** ohne Rollback (Home-Toggle hat Snapshot).
- **deleteAllData** lässt `zane_food_template_days`, `zane_checkin_schema_templates`, `zane_plan_drafts` stehen (Privacy/Restore-Schmutz). Plan-Drafts und template_days sind bewusst oft „nicht Backup“; für Account-Wipe trotzdem relevant.
- **Health-Vitals + Status-Periods** ohne Offline-Queue (direkt Supabase).
- **Schedules/Exercises** plain Upsert ohne `updated_at`-LWW.
- **flushBeforeSignOut** 5s Race → Sign-out trotz pending Diff (low/medium Grenzfall).
- Pending-Approval Cache-Pfad kurz `phase=ready` (low).

### train-schedule
- **Verified medium:** Session-Start cleared `loggingRef` vor Commit; Warmup-Confirm unguarded → Double-Tap/Doppel-Sessions.
- Finish-Seal ignoriert `timeSec` (Time-Mode-Sets verloren).
- Gelöschte Library-Exercises → Phantom-Rows `name: '?'`.
- TrainScreen bleibt offen nach server-ended Session (kann `ended:null` re-upserten).
- DayEditor Save vs Plan-Autosave Dual-Model (Copy-Verwirrung). Plan-Drafts sind Multi-Device-LWW by design (`zane_plan_drafts`).
- Autoreg/Meso-Taxonomien inkonsistent (Wizard / Editor / Guide A/B/C).
- Reset meso history ohne Confirm (low); Post-Warmup-Rest ohne Modal (low).

### home-lib *(unverified)*
- SessionDetail `prevEntryMap` skippt windowed Priors ohne Hydrate (Windowing-Folge, UX).
- Exercise-History filtert reps-only Sets weg.
- Vol PR zählt Warmups/Skipped.
- Library Recent Empty-State lügt nach langen Pausen.
- Stats sets-per-muscle unterzählt ended sets ohne `done:true`.
- `isTrainingDay` Weekday ignoriert Plan-Versions.
- History Cycle/Week-Labels ignorieren version-aware Cycle-Math.
- Home reimplementiert Improvement-Math; Meso-Labels doppelt (unify low).

### health-water-cardio *(unverified)*
- Day-Delete cleart keine waterLogs/foodLogs (Copy vs. Realität).
- Daily Log whole-row LWW Multi-Device (Batch-RPC hat Staleness; UI-Rebuild trotzdem heikel).
- Home Cardio-Prefill droppt Goal-Plan-Targets.
- Plan-done hängt an Free-Text-Type-Match.
- Fever-Nudge kann Vacation/Deload beenden ohne Warnung (`logbook-fever-nudge-declined-date` nur Decline-Tag).
- Deload unsichtbar in Day-Status-Chips.
- Water-Liste immer „ml“ für Imperial-User (low; Gewichts-Unit ≠ Volumen).

### food *(unverified)*
- Shopping Buy-Amount ignoriert Inventory-Stock.
- Low-Stock-Acks noch `foodId`-keyed nach `shopping_key` (Migration 0227 Kontext prüfen).
- Mid-day Meal-Plan-Activate re-fillt nicht.
- Recipe Share droppt `cookedWeightG`.
- `netCarbs` friert niedrigere kcal in Logs, Targets bleiben total-carb.
- Fav-Cache-Repair mount-once + day-lock Footgun (localStorage-Keys aus Claude.md).
- Scanner Grok/Claude-Toggle ohne Quota-Klarheit (low; `logbook-label-scanner-provider` ist Debug-Feature).

### medications *(unverified)*
- Pause plan cancelled nicht heutige planned Logs / Reminder.
- Meds schreibt nie `tzOffsetMinutes` (Reminder-Cron UTC-Fallback).
- Neue Plans starten PAUSED, Docs/DB Default active (Docs-Drift).
- Feature Map verspricht activate-on-push, Code immer active.
- Coach-Push clont immer neue Med-Identities (Duplicate Inventory).
- medication-reminder public triggerbar (Teil von H14).
- Coach-Client-Meds-View ignoriert active/date phases (low).

### coaching
- **Verified medium:** `asClient = data[0]` unordered → Multi-Pending verloren. (Active+Pending weitgehend durch `already_coached` geblockt.)
- Mixed unread Notes immer Coach-Pfad.
- Coach `setClientStore` Sync-Race (kein Serialisieren).
- `saveDefaultCheckinSchema` stampft alle non-self Rows inkl. Support.
- Invite-Flow missverständlich (kein Push/Email, kein „tell client to open app“).
- Self-Coaching zeigt Notes + Import-from-own (low).
- Accept-Modal Side-Effects (low; real coach replace largely blocked by `already_coached`).

### settings-onboarding *(unverified)*
- „Skip for now“ setzt permanent `onboardingCompleted`.
- Jeder Tour-Exit navigiert nach Home.
- Stale Copy: „Settings → How to…“ (Guides fehlt).
- Feature Map behauptet Spotlight-Tours (Card-Deck reality).
- What's New device-local (`logbook-whatsnew-seen`); New User sieht nur neuesten Eintrag (Contract).
- Appearance device-only Split; Accent gold vs copper Default (low).

### edge-functions *(unverified medium)*
- coaching-notify: Push ohne Note-Nachweis, ohne Rate-Limit.
- Scan-Quota vor Input-Validierung.
- Quota fail-open bei RPC-Ausfall (teure LLM/Vision).
- search-foods select/cache ohne Search-Quota.
- Upstream-Error-Details an Clients (low).

### database *(unverified medium)*
- Coach full DELETE/UPDATE Meds + Adherence-Logs.
- Coach hard-delete Client-Schedules.
- `sync_*_batch` Column-Lists ohne CI.
- Live inventory ohne `authenticated_exec` Canary.

### pwa-public *(unverified medium)*
- Public-Seiten runtime-SWR trotz „außerhalb SW“-Doku (Content-Hash/`?v=` ist der Contract).
- notificationclick ignoriert URL wenn App offen.
- Push-UI ACTIVE trotz toter OS-Permission (half-on; Feature Map erwähnt verified opt-in).
- Autoreg-Guide doppelt (JSX + `autoreg-guide-page.js`) ohne Paritäts-Check. Claude.md: beide nachziehen.
- Precompile partial execute + fallback re-inject Globals.
- Kein CI SOURCES vs ASSETS (Loader-Regel: beide listen).

### security *(unverified medium)*
- Coaching push preview client-controlled.
- Chat-Attachments world-readable by URL.
- DEFAULT PRIVILEGES authenticated (siehe High).

---

## 5. UX Traps und Design-Inkonsistenzen

### UX-Fallen (cross)
| Problem | Impact |
|---------|--------|
| **Home-Cancel vs In-Session-Abandon** (Meso-Cache) | High: Progression springt *(unverified)* |
| Alte Session sieht leer aus während Lazy-Load (kein Skeleton, leerer catch) | „History weg“-Panik (Windowing: Lazy-Load erwartet) |
| Plan-Editor: Autosave vs Save vs „Unsaved“-Banner | Draft da, Live-Plan alt; Discard-Angst |
| Reminder-Toggle öffnet nur Push, Flag bleibt false | Toggle „kaputt“ |
| Favoriten-Stern scheitert still | Offline/Quota |
| Readiness/Meso-Sheets unschliessbar | wirkt wie Freeze |
| Coach Plan-Change-Note still fail | Client nicht informiert |
| Live-Cardio Cancel ohne Confirm | Minuten weg |
| „Hide meal categories“ vs Hilfetext-Polarität | low |

### Design-Drift
- **Frame** ohne `text-lift` (Card hat es) → Paper-Lesbarkeit Home/Cardio schlechter **(medium)**.
- **danger-border-boost** nur partiell adopted.
- **Toggle** im Plan-Editor 4× handgebaut (`#fff` knob) statt `UI.Toggle`.
- **Card ≈ Frame** Near-Duplikate.
- Wizard-Overlays (Exercise + Plan) copy-paste z-9998 (internals dokumentieren die Falle).
- Center-Dialoge (Update, What's New, Invite, Auto-Close) handgebaut statt Sheet center.
- Parallel: Sheet / MiniSheet / FullSheet / fixed Screen.
- Primary-CTA driftet von `Btn` (Gradient/Shadow/Typo).
- Semantische Farben (`#4a9fe0` Water/Glucose) ohne vollständige Light-Varianten.
- Display-Titel ohne Type-Scale; `.micro` / `.label` / `Label()`; `1px` vs `var(--hair-width)`; Icon-Größen ad hoc.
- **Positiv:** Radius 4/6/8/999 weitgehend eingehalten; Akzent über `--accent-rgb` reif.

### Immersive Chrome
Neben dem verified Time-Set-Bug: Sync-Saving-Dots hard gold `#e8a838`; Fat-Mode-Chip „Per kg“ trotz lbs (`UI.unit()`-Contract).

---

## 6. Funktionslücken / Half-finished / Unify-Kandidaten

| Thema | Art | Empfehlung |
|-------|-----|------------|
| Glucose/BP/Temp offline | **Gap (high)** | Collections wie waterLogs in `syncStore` |
| meal-reminder ≈ medication-reminder | **Unify (high)** | `_shared/reminder-lib.ts` |
| 4 Reminder-Functions Push-Boilerplate | Unify | Shared transport + domain policy |
| Dual Label-Scanner (2 Functions, 3 UIs) | Unify/Product | Ein Provider; Toggle admin-only (`logbook-label-scanner-provider`) |
| Food ↔ Meds: materialize, stock, coach push | Unify | `tracker-primitives` + push-Adapter |
| Autoreg-Guide In-App vs Public JS | Unify | Eine Content-Quelle + CI-Parität (Claude.md) |
| Support als `support_%` Pseudo-Coaching | Unify | Zentrale Guards / eigene Tabellen mittelfristig |
| Feature Map Meds ohne Weekly Prep/Pillbox | Gap | Katalog-Actions ergänzen (`feature-map-db.js`) |
| Legacy `zane_sessions.entries` JSONB | Housekeeping | Drop wenn Clients flächendeckend neu genug |
| Pillbox checks not in backup | Intentional | Restore-UX erwähnen, kein CI-Fail |
| Cooking draft / Recipe share deep link | Weitgehend complete | Info |

---

## 7. Security Notes

**Gut:**
- Owner-RLS, `zane_is_coach_of` mit Support-Exclusion, Batch-Syncs forcen `auth.uid()`, Invites nur über RPC, nutzerseitige Edge Functions re-resolven JWT, Secrets (service role, AI, VAPID private) nicht im Client, Anon-Key erwartbar für SPA, XSS-Fläche klein (React text + gezieltes Escaping).

**Handlungsbedarf:**

| Prio | Finding |
|------|---------|
| P0 | Cron Functions ohne Auth (verified) |
| P0 | YouTube `href` unguarded in Train + coach-writable *(unverified high)* |
| P0 | Support-Tickets bei Invite-Accept *(verified)* |
| P1 | Pushover literal fallback (verified) |
| P1 | AI columns INSERT unguarded *(unverified high)* |
| P1 | authenticated DEFAULT PRIVILEGES + CI `authenticated_exec` (Claude.md) |
| P1 | Coach UPDATE full settings; Coach DELETE meds/schedules |
| P2 | coaching-notify client preview; Chat attachments public URLs |
| P2 | Scan quota order; fail-open expensive kinds; search select/cache limits |
| P2 | Admin = single email SPOF (ops) |
| Info | Client credentials surface expected |

---

## 8. Prioritized Backlog

### P0 (sofort: Datenverlust / Abuse / Security)
1. **inProgress base-aware + gated settings write + kein CASCADE-Kill** bei offenen Sessions mit Sets.
2. **Auto-close:** settings/sets ok-Guards; Merge LWW für set fields; kein Reopen von server-ended; TrainScreen freeze.
3. **Favorites:** truthful `cache` + 23503-Fallback + Repair-Heal (stoppt global not-synced).
4. **`respond_to_coaching_invite`:** `AND id NOT LIKE 'support_%'` (Migration + `schema.sql` + `docs/database.md`).
5. **Cron Auth:** CRON_SECRET/service role in allen Reminder + auto-close; Cron-Jobs umstellen.
6. **Train YouTube-Link:** immer `sanitizeYoutubeUrl` (write + render + optional DB CHECK).
7. **Home-Cancel:** denselben MESO_KEY-Cleanup wie `abandon()`.

### P1 (kurzfristig: Vertrauen / Kern-Features)
8. SessionDetail PR + Home ↑/↓ an all-time/Deload-korrekte Helpers (`exerciseBests`, `LB.isImprovement`).
9. DailyLog AI-Felder preserven + hasLogContent (ohne AI-Spalten in Client-Sync zu schreiben).
10. Meds: Reminder serverseitig materialisieren (oder boot auto-fill) + pause cancels planned today + `tzOffsetMinutes` in app ready.
11. Self-coaching an Main-Store binden.
12. Top-level scalar boot merge (status/cardio/day types/week plan).
13. Time-set immersive chrome light-on-dark.
14. Pushover literal key entfernen (+ rotieren).
15. AI INSERT-Guards; DEFAULT PRIVILEGES revoke authenticated + inventory canary.
16. Coach settings write auf Plan-Activation-RPC verengen.

### P2 (Produktqualität / Unify / Polish)
17. Session-start `loggingRef` bis Commit; TrainScreen ended-guard; timeSec in finish seal; phantom exercises filtern.
18. Glucose/BP/Temp in syncStore; delete day vs trackers; daily log field-level merge.
19. Shopping stock-aware buy qty; shopping_key acks; meal activate mid-day; cookedWeightG share; netCarbs contract.
20. Onboarding Skip/Tour returnRoute; Guides copy; Feature-map tour/meds cards; What's New multi-device optional.
21. PWA: SOURCES↔ASSETS CI; notificationclick navigate; Autoreg single source. CACHE-Bump bleibt manuell.
22. Reminder/scan shared modules; Food/Meds primitives.
23. UI: Frame text-lift; Toggle/Sheet/Wizard/CenterDialog unify; danger-border helper; `UI.unit()` überall.

---

## 9. What looks healthy

- **Sync-Kern:** `unwrap`, `Promise.allSettled` + opFailure, Resurrection-Guards, getestetes History-Windowing (`totalVolume`/`doneSetCount` Aggregate).
- **Staleness** auf sets/daily_logs/meso (bewusst nicht überall; Tradeoff dokumentiert).
- **sys_ Catalog-Contract:** Materialize zu User-Copies in den Primärpfaden.
- **Plan-Wizard-Invarianten** matchen `docs/internals.md`.
- **Recipe share** Deep-Link stash bis ready (`logbook-pending-share`); Cooking draft weitgehend komplett.
- **Coach-of-client RLS** und Support-Exclusion in den meisten Read-Pfaden (Accept-DELETE ist die Ausnahme).
- **Theme-Tokens:** Radius-Skala, Accent-Pipeline, Light/Paper-Arbeit an Danger/Ink; Theme ist reif, Adoption uneben.
- **PWA Basis:** precache no-store, SWR, Update-Banner bei CACHE-Bump, Clear-Cache, `check-cache-version`, Recipe-Share offline-login-safe.
- **CI-Gates:** Syntax=Loader, backup coverage, emdash, db-docs, live drift (anon); Lücken bei RPC-Spaltenlisten und authenticated EXECUTE bewusst notieren.
- **User-facing Edge Functions** (search/scan/parse/AI/coaching-notify mit Membership) sind im Schnitt sauberer als die Cron-Familie.
- **AI server-authored** Design (Sync darf AI nicht clobbern) ist richtig; nur UI-Preserve fehlt.

---

## 10. Empfohlene nächste Schritte (ohne Auto-Fix)

1. P0-Paket als eigene PRs/Migrationen (Session-Kill, Favorites, Support-Accept, Cron-Auth).
2. Regressionstests: `store.test` Merge/inProgress, invite+support coexist, favorites FK, auto-close settings missing.
3. DB-Arbeit strikt nach Claude.md-Workflow: Migration → Nutzer ausführen → `docs/database.md` → `schema.sql` → Backup-Coverage.
4. SW-Cache nur bumpen, wenn du deploybare Fixes ausrollst und den Banner willst.
5. Unverified Mediums nicht blind fixen: vor dem Anfassen den genannten Pfad noch einmal lesen.

---

## Anhang: Verifizierungs-Status

| # | Titel | Status |
|---|--------|--------|
| H1–H15 | Abschnitte 3.1–3.6 High | **verified** |
| Session start loggingRef | **verified medium** |
| asClient data[0] | **verified medium** (Severity vom Verifier medium) |
| Accept modal side effects | **verified low** |
| Alle übrigen Medium/Low/Info | **unverified** (Domain-Audit, Code-Hinweise, nicht separat adversarisch bestätigt) |

**Workflow:** `.grok/workflows/deep-audit.rhai` · Handle `deep-audit`  
**Maschinenlesbar (Run-Scratch):** `deep-audit-data.json` (session-lokal, nicht im Repo)

*Read-only Audit. Keine Code- oder Schema-Änderungen in diesem Durchlauf.*
