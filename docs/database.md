# Datenbank-Referenz (Supabase)

Vollständige Referenz aller Tabellen, Spalten, RPCs und der Realtime-Konfiguration.
Die Spalten-Doku enthält bewusst auch die Verhaltens-Contracts der App (wie eine
Spalte gelesen, geschrieben und aufgelöst wird). Vor Arbeit an Migrationen,
`store.js`-Sync oder Features mit DB-Berührung den passenden Abschnitt lesen.

**Pflege-Regel:** Bei jeder DB-Änderung diese Datei mitziehen (Workflow: CLAUDE.md,
Abschnitt „Datenbank (Supabase)"). `supabase/schema.sql` ist der vollständige
Schema-Snapshot (Tabellen, RLS, Funktionen, Trigger, Realtime) und muss immer mit
dem Live-Schema übereinstimmen.

**Drift-Checks (automatisiert):** `tools/check-db-docs.cjs` (CI, bei jedem Push)
replayt alle Migrationen und schlägt fehl, wenn Tabellen/Spalten/Funktionen nicht
in `schema.sql` und dieser Datei nachgezogen wurden. `tools/check-db-live.cjs`
(`.github/workflows/db-drift.yml`, wöchentlich + manuell) vergleicht zusätzlich
die echte Datenbank. Mit Service-Key (GitHub-Secret `SUPABASE_SERVICE_ROLE_KEY`):
volles Inventar via `admin_schema_inventory()` (Spalten in beide Richtungen,
anon-EXECUTE-Grants, Realtime-Publikation). Ohne Key: Existenz-Probe aller
`schema.sql`-Spalten per anonymer Read-only-Selects. (Die PostgREST-OpenAPI-Spec
unter `/rest/v1/` wäre die schlankere Quelle, ist bei Supabase aber nur noch mit
dem service_role-Key abrufbar.)

**Playbook: db-drift-Workflow schlägt fehl** (der Nutzer postet typischerweise
das Actions-Log). Fehlschläge sofort bereinigen, nicht liegen lassen; jede
Bereinigung endet damit, dass `node tools/check-db-docs.cjs` lokal grün ist und
der Nutzer den Workflow re-runnt (Actions → „DB drift check" → Run workflow).

- **Exit-Code 2 (operational):** kein Drift, sondern Netz/Auth/Setup. Erste
  Log-Zeile prüfen: `service key: not set` heißt Secret-Name falsch (muss exakt
  `SUPABASE_SERVICE_ROLE_KEY` heißen). „Has Migration 0142 been applied?" heißt:
  Nutzer bitten, Migration 0142 auszuführen. Sonst: Supabase-Erreichbarkeit.
- **Exit-Code 1 (echter Drift), je nach Meldung:**
  - *Spalte/Tabelle existiert live, fehlt im Repo:* Es wurde an den Migrationen
    vorbei live geändert (SQL-Editor/Dashboard). Mit dem Nutzer klären, ob die
    Änderung bleiben soll. Ja: als idempotente Migration nachziehen
    (`IF NOT EXISTS`) und `schema.sql` + diese Datei nachdokumentieren.
    Nein: Nutzer baut sie live zurück.
  - *Spalte/Tabelle im Repo, fehlt live:* Entweder wurde eine Migration nie
    ausgeführt (Nutzer bitten, sie auszuführen) oder live wurde etwas
    entfernt. Erst klären, dann Repo oder DB angleichen; nie stillschweigend
    aus der Doku löschen.
  - *`anon_exec = true`:* zuerst `EXPECTED_ANON_EXEC` in `tools/check-db-live.cjs`
    prüfen, dort stehen bewusste Ausnahmen (aktuell nur `get_public_feature_map`,
    siehe „Grant-Fallen" unten). Ist die Funktion dort nicht gelistet, ist es eine
    echte Grant-Falle: REVOKE-Migration nach dem Muster von 0141 nachschieben.
    Fehlt umgekehrt der Grant für eine gelistete Ausnahme, ist der Live-Grant
    kaputt (Migration erneut prüfen), nicht die Doku.
  - *Unerwartete App-Tabelle in der Realtime-Publikation:* Wenn gewollt, die
    Realtime-Doku (hier + CLAUDE.md) **und** `EXPECTED_REALTIME` in
    `tools/check-db-live.cjs` nachziehen; sonst Publikation bereinigen lassen.

## Tabellen & Spalten

### `zane_exercises`

Übungs-Library des Users.

- `id` (text), `user_id` (uuid), `name`, `note`, `category` (text), `tags` (text[]), `equipment` (text)
- `unilateral` (boolean), `movement_type` (text: 'bilateral'|'unilateral'|'assisted'|'mobility'; 'cardio' on the built-in cardio exercise). `'assisted'` (assisted dip/pull-up/chin-up) stores the machine/band assistance as a **negative** kg load, resolved via `LB.isAssisted(ex)`; no schema change (free-text column).
- `no_weight_reps` (boolean, default false): **legacy** binary "no weight" flag; superseded by `log_mode` but kept written in sync (`no_weight_reps = log_mode <> 'weight'`) so older cached clients still hide the weight field. Read via the `LB.exerciseLogMode` fallback, never trust it alone once `log_mode` exists.
- `log_mode` (text, nullable): how the exercise is logged. `'checkbox'` (tick each set, no numbers, 0 volume) | `'reps'` (reps only, no weight, 0 volume) | `'weight'` (weight + reps); null ≈ `'weight'`. Resolved by `LB.exerciseLogMode(ex)` (log_mode wins, else legacy `no_weight_reps ? 'reps' : 'weight'`). The exercise editor shows a **Logging** picker whenever `equipment ∈ {no_equipment, bodyweight}` OR `movement_type === 'mobility'`; loaded equipment is always weight+reps, and `movement_type === 'assisted'` always forces weight+reps (it logs the negative assistance load). Migration 0139.
- `pull_bodyweight` (boolean, default false): opt-in, pulls the user's latest logged bodyweight (`LB.latestBodyweight`) as the set's starting weight. Only meaningful for `equipment='bodyweight'` + `log_mode='weight'`; the editor toggle is only enableable once a weight has been logged. Replaces the old implicit auto-pull that fired for every bodyweight exercise. Resolved by `LB.shouldPullBodyweight(ex)`. Backfilled `true` for existing bodyweight rows to preserve behaviour. Migration 0139.
- `progression_reps` (int, **deprecated/legacy**): used to be a global cross-plan "Rep Target" editable in the exercise screen that silently overrode every plan's per-item reps on save; removed from the UI once per-plan-item Range mode plus the per-exercise Smart Progression override (`repsMax`/`progressionOffset`, Migrations 0134/0135) made it redundant and conflicting. Column kept for old data / backward-compat reads only (e.g. `addExercise`'s new-item seed default in `screens-schedule.jsx`); no longer written to by any UI.
- `youtube_url` (text, nullable): optional form-reference video; shown as a play button in the exercise editor/detail and during training. Migration 0106.
- `note_pinned` (boolean, default false): when true and the exercise has a non-empty `note`, that note pops up in a must-acknowledge sheet the first time the exercise becomes active in a session (once per session, every workout), so a setup note can't be forgotten. A per-exercise toggle next to the note field (`ExerciseCreator` / `ExerciseDetailScreen`) sets it; the training screen fires the sheet on exercise-start (dismissed exIds tracked per session). Store field `note_pinned` (exercises are a raw DB-row passthrough, so it flows through load/sync/backup with the other columns). In the user backup. Migration 0167.

### `zane_workout_templates`

- `id` (text), `user_id` (uuid), `name` (text), `created_at` (timestamptz)
- `exercises` (jsonb): `[{ exId, name, sets, reps, repsPerSet, repsMax, progressionOffset, supersetGroup }]`, structure only, no logged sets. `repsMax` optional: top of a Range reps target, `reps` holds the floor, mutually exclusive with `repsPerSet`. `progressionOffset` optional: per-exercise Smart Progression override, `0` = off, `N` = on with base+N ceiling, unset = inherits the global setting.
- Store field: `store.workoutTemplates`. Synced via `syncStore` diff (like `cardioPlans`). Saved from a finished freestyle session, used to start a freestyle session ("From template") or imported into a plan day (Plans|Templates sub-tab in the day import picker). Migration 0107.

### `zane_checkin_schema_templates`

- `id` (text), `user_id` (uuid, the coach), `name` (text), `schema` (jsonb, same shape as `zane_coaching.checkin_schema`), `created_at` (timestamptz)
- RLS: owner-only (`auth.uid() = user_id`), identical pattern to `zane_workout_templates`. Not loaded on a coach-load of a client's store (`isCoachLoad`): these are the acting coach's own saved schema snapshots, never the viewed client's.
- Store field: `store.checkinSchemaTemplates`. Synced via `syncStore` diff, no dedicated RPC. Soft-capped at 5 per user, enforced client-side only (UI hides "Save as template" once 5 exist). Used from both `CheckInSchemaBuilder` instances: the coach's per-client builder (`screens-coaching-detail.jsx`, `ClientCheckInsTab`) and the self-coaching builder (`screens-coaching-tabs.jsx`, `ClientCheckInTab` with `isSelf`); real (non-self) clients never open the builder. Each template row supports apply (load into the draft), update-in-place (overwrite name/schema, keeps the same `id`), and delete. Exists so a coach can snapshot the outgoing default before overwriting it for "All clients" (previously instant and irreversible), and reuse a saved form across clients or, for self-coaching, across time. Migration 0152.

### `zane_schedule_backups`

- `id` (text), `user_id` (uuid), `schedule_id` (text), `schedule_name` (text), `days` (jsonb: same format as `zane_schedules.days`, always a non-empty array), `created_at` (timestamptz)
- Automatic snapshots of a schedule's `days`, written fire-and-forget from `syncStore` whenever `days` changes to a valid non-empty array. Never written if `days` is empty or malformed (guards against backing up broken state). Used by the "Backups" button in the plan viewer to restore a previous day layout. Initial snapshot of all valid plans inserted via Migration 0114.

### `zane_plan_drafts`

- `user_id` (uuid), `schedule_id` (text), `draft` (jsonb: the in-progress editor draft, same shape as the schedule object being edited), `updated_at` (timestamptz); PRIMARY KEY `(user_id, schedule_id)`. Migration 0162.
- Multi-device autosave for the plan editor. `ScheduleEditScreen` holds edits in a local `draft` that only reaches `zane_schedules` on an explicit Save, so until then an app kill / closed tab / device switch loses the work. This table holds that draft, synced across devices, **deliberately decoupled** from the committed plan: a debounced autosave writes only this small row (never the large `zane_schedules` row), so it can never touch `days`/`versions`, and it stays out of the `zane_schedules` boot-merge entirely. Owner-only RLS (`to authenticated`), last-write-wins over `updated_at`. One draft per (user, plan); the row is **deleted** the moment the editor Saves (commits to `zane_schedules`) or Discards. Transient in-progress state, **not** in user backups (`EXCLUDED` in `check-backup-coverage.cjs`). No FK to `zane_schedules` (the two stay independent); the app deletes a plan's draft row when the plan itself is deleted.

### `zane_meso_states`

One row per (user, plan). Store field: `store.mesoStates`. Migration 0120.

- `id` (text): `userId + '_' + scheduleId`, deterministisch
- `user_id` (uuid), `schedule_id` (text), `weeks` (int, nullable: null = autoregulate-only, no fixed block length, see `zane_schedules.mesocycle_autoregulate`. Migration 0160), `start_date` (text, YYYY-MM-DD), `start_cycle_index` (int, default 0)
- `deltas` (jsonb, default `{}`): `{ exId_dayId: ±N }` set count adjustments
- `joint_flags` (jsonb, default `{}`): `{ exId: true }` flagged exercises
- `pump_low_counts` (jsonb, default `{}`): `{ exId: N }` low-pump counter
- `weight_boosts` (jsonb, default `{}`): `{ exId_dayId: increment }` weight adjustment applied to next session's seed. Usually a positive earned increase; can also be a **negative** cut from the `rep_miss_counts` streak below (see there). Re-earned every session either way: on the exercise's next training day the key is wiped first and only re-set if that session's outcome (earn or cut) writes it again, so neither a boost nor a cut lingers past the one session it seeds. **Range exercises earn by double progression** (`LB.mesoEarnTarget` / `LB.mesoRepOutcome`): the boost is granted only once the TOP of the range is reached, on a staggered per-set ladder, first (freshest) set must hit `plannedRepsMax`, the last only the floor `plannedReps`, sets in between linearly interpolated (a single working set uses the range midpoint). This makes the weight HOLD while the lifter climbs the range instead of creeping every session, then jump one increment. When a boost (or a cut) does move the weight, the seed resets the reps back to the range floor (`repFloor` arg to `LB.resolveMesoSeedSuggestion`) so double progression restarts at the new load. Uniform / Per-Set items are unchanged (the ladder collapses to their plain target). Migration 0166 note: earn-ladder + reps-reset shipped there alongside `meso_recap`, no schema change. **Deleting a finished meso session rolls back the `weight_boosts` / `rep_miss_counts` keys it earned** (`LB.revertMesoSessionBoosts`, when it was the most recent non-deload session of its day), so a re-log doesn't seed on an older weight with the orphaned boost still stacked on top; both the store copy and the `logbook-meso-state-<planId>` cache are re-stamped so `getMesoState` prefers the rollback. Set-count `deltas` are intentionally not rolled back.
- `growth_counts` (jsonb, default `{}`): `{ exId_dayId: N }` how many set-grants that exercise has received this meso block, from either a "Volume: Not enough" answer **or** a low-soreness recovery signal ("Never sore" / "Healed a while ago"). Both share this pool so the two feedback questions stay fair to each other; kept separate from `deltas` so an unrelated shrink event never distorts turn fairness. Used to rotate which exercise of a muscle group grows next (fewest grants among those still below their own per-exercise `deltas` ceiling wins, ties toward the muscle group's main/first lift; a newly swapped-in exercise is seeded at the group's current max instead of 0 so it can't cut ahead) instead of always growing only the main lift. Store field `growthCounts`. Migration 0130.
- `rep_miss_counts` (jsonb, default `{}`): `{ exId_dayId: N }` consecutive-session counter, objective counterpart to the subjective soreness/joint/volume signals above. A working set "misses" when it doesn't reach its own rep target (per-set target if the item uses Per-Set, else the uniform/Range-floor `plannedReps`; a Range exercise's `plannedRepsMax` only marks the ceiling that EARNS extra progression, not what counts as hit). The exercise's own LAST working set is exempt from counting as a miss (an all-out final set failing from accumulated fatigue doesn't mean the weight itself is too heavy; an earlier set failing does), except when there's only one working set, which has no earlier set to lean on and counts directly. Any qualifying hit resets the counter to 0. Two qualifying misses in a row cut that exercise's weight by one increment for the next session (a negative entry in `weight_boosts`, reusing the same re-earned-every-session mechanism) and reset the counter. Runs independently of the joint/pump/volume gates and of Load-only mode (where it's the *only* rep-driven lever, since set deltas are frozen there). Store field `repMissCounts`. Migration 0165.
- `completions` (int, default 0): how many meso blocks completed on this plan
- `pending_meso2` (boolean, default false): set when the last meso week finishes and the user chose to start a deload first; cleared when the user responds to the Meso 2 offer on the home screen after deload ends. Store field `pendingMeso2`. Migration 0121.
- `started_at` (timestamptz, nullable): exact block-start timestamp; `mesoCurrentWeek` prefers it over the date-only `start_date` so a previous block's sessions logged the same calendar day the new block starts can't fast-forward the flex week/RIR counter. Store field `startedAt`; was client-only until it round-trips through the DB in Migration 0138.
- `created_at`, `updated_at` (timestamptz)
- Synced via `syncStore` diff. Ersetzt den per-Device localStorage-Key `logbook-meso-state` (Meso-Fortschritt ist cross-device). localStorage dient während einer Training-Session als schneller Write-Through-Cache; am Session-Ende via `flushMesoStateToStore()` in den Store (→ DB) geflusht.

### `zane_feature_grants`

- `feature` (text), `email` (text)

### `zane_profiles`

- `id` (uuid), `name` (text)
- `approved` (boolean, default = `signup_default_approved()`): auto-approved, außer die globale Flag `zane_app_config.signup_requires_approval` ist an

### `zane_app_config`

Globale Admin-Config (RLS an, nur SECURITY-DEFINER-Funktionen greifen zu). Treibt den Column-Default von `zane_profiles.approved`; ein Flip ändert also nur künftige Signups.

- `id` (int, Singleton = 1)
- `signup_requires_approval` (boolean, default true)
- `auto_approve_remaining` (int, nullable): Batch-Budget. Ist Approval aus und das Budget gesetzt, dekrementiert jedes neue Signup es via `signup_consume_budget()` (AFTER-INSERT-Trigger auf `zane_profiles`); bei 0 schaltet der Trigger `signup_requires_approval` wieder an und löscht das Budget.
- `force_update_nonce` (text, nullable): gesetzt von `admin_force_update()`, pusht das "New version available"-Banner an alle Clients ohne `sw.js`-Cache-Bump. Migration 0131.

### `zane_feature_map`

**DRAFT-Ebene** der Feature-Map (Option A + Live-Publish). Der **Master-Inhalt** liegt versioniert im Code (`src/feature-map-db.js`, `window.FEATURE_MAP`, Kategorien + Karten mit stabiler `id`); den rendern alle User und die Public-Seite als Basis. Diese Tabelle ist der **private Entwurf des Admins**: hier landen alle In-App-Änderungen (ausblenden/editieren/hinzufügen/sortieren), gekeyt auf die Katalog-Karten-`id`, als Live-Vorschau im `FeatureMapScreen` über den Katalog gelegt. Beim **Publish** (`publish_feature_map()`) wird dieser Stand in `zane_feature_map_published` gespiegelt; „Discard all" (`discard_feature_map()`) setzt den Entwurf zurück auf den veröffentlichten Stand. **Nicht** im User-Backup (in `check-backup-coverage.cjs` `EXCLUDED`). Migration 0154 (Content) → 0155 (Overrides) → 0156 (Publish-Flow).

- `card_id` (text, PK): Katalog-Karten-`id`, oder ein `custom-…`-Slug für admin-hinzugefügte Karten
- `hidden` (boolean, default false): Karte in der Vorschau/Publikation ausblenden (Soft-Delete)
- `is_custom` (boolean, default false): true = admin-hinzugefügte Karte (nicht im Katalog)
- `cat`, `name`, `role` (CHECK null/`user`/`coach`/`both`), `summary`, `actions` (jsonb), `sort` (int): alle **nullable**. Bei Katalog-Karten überschreiben nicht-null Werte den Default (null = erben); bei Custom-Karten der volle Inhalt. `sort` = Reihenfolge innerhalb der Kategorie (null = Katalog-Reihenfolge).
- `created_at`, `updated_at` (timestamptz, default `now()`)
- **RLS:** eine Policy `feature_map_admin_all` (`FOR ALL TO authenticated`), nur Admin via `auth.email() = 'office@btc-prime.biz'` liest **und** schreibt.

### `zane_feature_map_published`

**PUBLISHED-Ebene** der Feature-Map: die Ebene, die tatsächlich alle sehen (Public-Seite + alle eingeloggten User rendern Katalog + diese Overrides). Spaltenidentisch zu `zane_feature_map`. Wird nur durch `publish_feature_map()` (Draft → Published) geschrieben und von `discard_feature_map()` (Published → Draft) sowie dem Bake-Workflow gelesen/geleert. **Nicht** im User-Backup (`EXCLUDED`). Migration 0156.

- `card_id` (text, PK), `hidden` (boolean, default false), `is_custom` (boolean, default false)
- `cat`, `name`, `role` (CHECK null/`user`/`coach`/`both`), `summary`, `actions` (jsonb), `sort` (int): wie bei `zane_feature_map`
- `created_at`, `updated_at` (timestamptz, default `now()`)
- **RLS:** eine Policy `feature_map_published_admin_all` (`FOR ALL TO authenticated`), nur Admin liest direkt (für den Unpublished-Diff). Alle anderen lesen über `get_public_feature_map()`.
- **RPCs:** `publish_feature_map()` (admin, SECURITY DEFINER, atomar Draft → Published) · `discard_feature_map()` (admin, SECURITY DEFINER, Published → Draft) · `get_public_feature_map()` (SECURITY DEFINER, an `anon` **und** `authenticated` gegrantet: Login-freie/Alle-User-Leseansicht; hidden **Custom**-Karten werden zurückgehalten, hidden-Flags auf Katalog-Karten kommen mit). `anon`-Execute ist hier **gewollt** (einzige Feature-Map-Funktion mit anon-Zugriff); `publish_feature_map`/`discard_feature_map` müssen für `anon` `false` sein.

### `zane_push_subscriptions`

- `id` (text: endpoint URL), `user_id` (uuid), `endpoint` (text), `p256dh` (text: client EC public key, base64url), `auth` (text: auth secret, base64url), `created_at` (timestamptz)
- One row per device per user; managed by `subscribeWebPush`/`unsubscribeWebPush` in `store.js`; 410/404 responses auto-prune stale rows via the `web-push` Edge Function. Migration 0080.

### `zane_pushover_active`

- `id` (text), `nonce` (text)

### `zane_schedules`

- `id` (text), `user_id` (uuid), `name` (text), `days` (jsonb), `archived` (boolean, default false)
- `versions` (jsonb, default `[]`): array of `{ validFrom: 'YYYY-MM-DD', days: [...] }` sorted newest first; used for plan-change-from-date versioning
- `is_flex` (boolean, default false): **Flexible plan**, a cycle variant whose position advances only on a logged session/skip, never by calendar date; rest days can't push the plan forward. Migration 0090.
- `sessions_per_week` (int, nullable): weekly training-frequency goal, the adherence denominator for flex plans. Migration 0090.
- `mesocycle_weeks` (int, nullable): when set, this plan runs as a **bounded** mesocycle of that many weeks (RIR taper + auto-regulation feedback during training, ending in a deload/next-block offer). Truthy = this plan is a bounded block, which auto-starts (or re-starts) a `zane_meso_states` row with `weeks` set and suppresses the generic 8-week auto-deload nudge (that nudge is `mesocycle_weeks`-specific — it must NOT fire mid-block, but an unbounded autoregulate-only plan below has no block-end of its own to reach otherwise, so it still needs that generic nudge). Set/cleared in the plan editor's Auto-regulate section's nested "Fixed-length block" toggle, or the wizard's Meso step.
- `mesocycle_start_rir` (int, nullable, app-fallback 3): RIR target for meso week 1, range 0 bis 3.
- `mesocycle_end_rir` (int, nullable, app-fallback 0): RIR target for the final/peak meso week, range -3 bis 0. A **negative** end drives auto-prescribed lengthened partials during training: `|RIR|` partials per working set. `LB.mesoRirForWeek(week, weeks, startRir, endRir)` tapers linearly between the two. Migration 0133.
- `mesocycle_rir_enabled` (boolean, default true): **RIR taper on/off**. When false the meso still runs on volume (delta) auto-regulation, load progression and deload, but the weekly RIR target watermark and the negative-RIR lengthened-partials prescription are both suppressed. Resolved by `LB.mesoRirEnabled(sch)` (`!== false`, so only an explicit false disables; a bare null can't mean "off" because the app falls back to 3/0). Toggled by a **RIR taper** switch in the plan wizard's Meso step and the editor Options sheet (below the weeks stepper; it hides the Start/End RIR steppers + taper preview when off). `mesoRirVal` in the training screen becomes null when off, which gates both the watermark and `mesoPartials`. Migration 0140.
- `mesocycle_autoregulate` (boolean, default false): runs the **same** autoregulation engine as a mesocycle (volume/load feedback, `zane_meso_states`) with no bounded week count at all: no RIR taper, no completion/deload-offer flow, deltas/growth rotation/weight boosts accumulate indefinitely. Independent of `mesocycle_weeks` — `LB.mesoActive(sch)` (`!!(sch?.mesocycle_weeks || sch?.mesocycle_autoregulate)`) is the "is the engine on at all" check; `mesocycle_weeks` alone still means "and it's ALSO a bounded block" for RIR/completion/badge logic, which stays keyed on it directly. A mesoState created for an autoregulate-only plan has `weeks: null`. Toggled by the plan wizard's Meso step ("Autoregulate volume and load" option) or the editor Options sheet's Auto-regulate master toggle (the nested "Fixed-length block" toggle separately controls `mesocycle_weeks` on top). Migration 0160.
- `mesocycle_autoregulate_mode` (text, nullable): for an unbounded `mesocycle_autoregulate` plan, WHICH halves of the engine run. null/`'both'` = tune sets AND weight (default); `'load'` = tune weight only, set counts stay at the plan's authored value. Resolved by `LB.autoregLoadOnly(sch)` (true only for an unbounded autoregulate plan whose mode is `'load'`; a bounded mesocycle always regulates both, so a stray value there is ignored). In `'load'` mode all set deltas are frozen at the `commitContrib` choke point (same mechanism as the final-week freeze) and seeding never applies deltas (`LB.autoregLoadOnly` guard in `buildSessionEntries`), so leftover deltas from a prior "Volume + Load" run go inert without wiping the mesoState. The three feedback questions all still fire, but soreness is **repurposed**: instead of tuning set counts it acts as a recovery brake on weight, a muscle answered "still sore" is added to `mesoSoreBlockRef` and its exercises skip the weight boost that session (an extra load-only gate in `computeMesoGains`, alongside the usual joint/pump/volume + all-reps-hit gates). Only meaningful with `mesocycle_autoregulate` true; the bounded mesocycle ignores it. Set by the wizard's Autoregulate step and the editor Options sheet's Volume+Load / Load only picker. Migration 0161.
- `program_type` (text, nullable): when `'531'`, this schedule is a **Wendler 5/3/1** program (NULL = a normal history-based plan). Resolved by `LB.is531Plan(sch)`. Migration 0143.
- `program_data` (jsonb, nullable): 5/3/1 config plus per-lift state: `{ unit, includeDeload, mainLifts: { <exId>: { tm, kind, stall } }, tmHistory: { <exId>: [{ cycle, tm, reason }] }, bumpedCycle }`. `kind` is `squat|bench|deadlift|ohp` and drives the per-cycle TM bump (`LB.tmBump531`: upper +2.5kg/+5lb, lower +5kg/+10lb). During training a 531 main lift's working sets are `round(pct * tm)` off the current 4-week wave (`LB.fiveThreeOneSets`); the TM rises one step each cycle when the AMRAP top set hits its required minimum reps, holds on a miss, and resets to 90% after two missed cycles in a row (`stall`). `tmHistory` (reason `start|bump|reset`) feeds the progress chart; `bumpedCycle` gates the once-per-cycle prompt. The full shape is opaque to the DB (jsonb) — the app owns it; see `docs/internals.md` (5/3/1). Assistance exercises on a 531 plan are ordinary items and keep normal Smart Progression. Migration 0143.
- `is_template` (boolean, default false): coach-only Plan-tab bucket flag, splits a coach's own schedules into "My Plans" (false) vs "Client Templates" (true) sub-tabs (`PlanScreen`). Pure client-side grouping, no behavior change to the plan itself; flipped by a toggle in `PlanViewerScreen`'s plan actions. Always false for non-coach users' plans. Migration 0164.

Verhalten:

- **Schedule-Objekte sind ein DB-Column-Passthrough:** die snake_case-Spalten `is_flex`/`sessions_per_week`/`mesocycle_weeks`/`mesocycle_start_rir`/`mesocycle_end_rir`/`mesocycle_rir_enabled`/`mesocycle_autoregulate`/`mesocycle_autoregulate_mode`/`program_type`/`program_data`/`days`/`versions`/`archived`/`is_template` liegen unverändert auf dem Store-Objekt; nur das local-only `mode`-Feld wird vor dem Upsert entfernt.
- `LB.isFlexPlan(sch)` = `sch.is_flex === true`; ein Flex-Plan ist nie ein Weekday-Plan.
- **Flex-Position = `cycleIndex`** (action-advanced; `todaysDay`/`nextDay` lesen ihn direkt und ignorieren `cycleStartDate`, das für Flex null bleibt). Streak-/Missed-Workout-Karten und die datumsbasierten Home-Strip-Marker sind für Flex ausgeblendet; der Home-Strip zeigt die Rotation (`D1…Dn`) mit hervorgehobenem Next-up-Tag.

### `zane_sessions`

- `id` (text), `user_id` (uuid), `schedule_id`, `day_id`, `day_name` (text), `date`, `started_at`, `ended` (timestamptz), `duration_minutes` (int), `feel` (text: easy|good|hard|very_hard|max)
- `entries` (jsonb): **legacy, wird nicht mehr geschrieben**. Seit Migration 0058 sind `zane_session_entries`/`zane_sets` die alleinige Quelle, alte Zeilen behalten ihren JSONB-Stand. Erst per separater Migration droppen, wenn alle Clients ≥ v2.085 sind (alte SW-Caches laden sonst noch den alten Boot-Code, dessen Select dann 400 würfe).
- `is_bonus` (boolean, default false): Extra-Session, die den Plan-Fortschritt beim Beenden nicht automatisch vorrückt. Gesetzt beim Start von Freestyle-Sessions sowie von Plan-Tagen, die nicht der heutige Tag sind oder wenn der heutige schon absolviert wurde (`screens-home.jsx`). Beim Beenden entscheidet der User (`shouldAdvance = isBonus ? advanceCycle : true` in `screens-train.jsx`); wählt er das Vorrücken, wird das Flag auf der gespeicherten Session wieder gelöscht. Store field `isBonus`, stripped from the row when false. Migration 0089.
- `is_freestyle` (boolean, default false): ad-hoc gestartete Session ohne Plan-Tag (leer oder „From template", startet immer auch mit `is_bonus`). Bei leerer Session öffnet sich direkt das Add-Exercise-Sheet; beim Beenden kann der User einen Namen vergeben (wird `day_name`). Store field `isFreestyle`, stripped from the row when false. Migration 0089.
- `is_deload` (boolean, default false): session logged during a deload week; excluded from progression seeds, regression detection and PR baselines so a light week never skews training. Store field `isDeload`, stripped from the row when false. Migration 0108.
- `meso_recap` (jsonb, nullable): durable per-session snapshot of the autoregulation / mesocycle feedback given and the weight/set bumps or cuts earned, so the session detail screen (`SessionDetailScreen`, „Feedback recap" button) can show it long after the fact and across devices. Written at session finish in `screens-train.jsx` (`buildMesoRecap`), previously only in device localStorage. Shape: `{ loadOnly, meso, week, unit, groups: [{ muscle, general: [{title,sub}], joint: [{title,sub}] }], gains: [{ name, weightDelta, setDelta }] }` (app-defined, not queried server-side). Store field `mesoRecap`, only mapped onto the row when set. Part of the user backup (round-trips via `sessionToRow`). Migration 0166.

### `zane_session_entries`

- `id` (text), `session_id` (text), `user_id` (uuid), `entry_idx` (int), `ex_id` (text), `name` (text), `planned_sets` (int), `planned_reps` (int), `planned_reps_per_set` (integer[]), `note` (text), `superset_group` (text)
- `planned_reps_max` (int, nullable): top of a **Range** reps target set in the plan/template item editor, e.g. "8-12"; `planned_reps` holds the floor. Store field `plannedRepsMax`. For a Range-mode exercise this also replaces Smart Progression's global `progression_range_top` add-on as the weight-increase ceiling; see `progressionSuggestion`/`progressionTargetForSet`. Migration 0134.
- `planned_progression_offset` (int, nullable): **per-exercise Smart Progression override**, settable in the Uniform/Per-Set sets-reps editor independent of Range mode. `null` = inherit the global `smart_progression`/`progression_range_top` setting, `0` = explicitly **off** for this exercise regardless of the global toggle, `N` = explicitly **on** with a ceiling of base reps + `N`. Store field `plannedProgressionOffset`. `0` is a meaningful, distinct value: always use `??`/`!= null` checks against it, never `||`. Resolved together with `planned_reps_max` by the shared `LB.progressionEnabled`/`LB.progressionCeilingFor` helpers in `store.js` (a Range item's `repsMax` always wins over an offset). Migration 0135.
- `planned_techniques` (text[], nullable): **per-set planned intensity techniques**, one slot per planned set (`null` where a set has no technique), chosen in the plan/template item editor so each set auto-arms its technique live during training instead of relying on the client to pick it. Each non-null element is a `zane_sets.technique` value (`'drop'` | `'myorep'` | `'myorep_match'` | `'amrap_variations'` | `'lengthened_partial'` | `'weighted_stretch'`). Same per-set shape as `planned_reps_per_set`; lets a coach prescribe e.g. Drop on set 1, Myo on set 2, or a technique on just the last two sets. Copied from the schedule day item / template at session start (like the other `planned_*` columns) so a later plan edit does not change an in-progress session; carried in the `zane_schedules.days`/`zane_workout_templates.exercises` JSONB as `plannedTechniques` passthrough. Store field `plannedTechniques`. Surfaced by `zane_entries_json`. Migrations 0157 (single-technique + scope, superseded) and 0158 (per-set array).

### `zane_sets`

- `id` (text), `session_id` (text), `entry_id` (text), `user_id` (uuid), `set_idx` (int), `kg` (numeric), `reps` (int), `reps_l` (int), `reps_r` (int), `done` (boolean), `skipped` (boolean), `warmup` (boolean), `updated_at` (timestamptz)
- `time_sec` (int, nullable): logged duration in seconds for a time-based set (`log_mode = 'time'`, e.g. HIIT or a max hold). Adds 0 to volume, counts as done once set. Synced through `sync_sets_batch` and surfaced by `zane_entries_json` (`timeSec`). Migration 0144.
- `technique` (text, nullable): intensity technique the set was logged with, one of `'drop'` | `'myorep'` | `'myorep_match'` | `'amrap_variations'` | `'lengthened_partial'` | `'weighted_stretch'`. Plain text, no DB CHECK. Migration 0115 seeded `'drop'`/`'rest_pause'`/`'myorep'`; the later techniques were added client-side and `'rest_pause'` is no longer written.
- `drops` (jsonb, nullable): for drop sets, `[{kg, reps}, ...]` ordered heaviest→lightest. `drops[0]` mirrors the top-level `kg`/`reps` so progression seeds use the first drop; only the first drop counts toward volume and doneSetCount. Migration 0115.

### `zane_coaching`

- `id` (text), `coach_id` (uuid), `client_id` (uuid), `status` (text: pending|active), `created_at` (timestamptz), `checkin_requested_at` (timestamptz, nullable), `checkin_enabled` (boolean, default true)
- `checkin_schema` (jsonb, nullable): coach-definiertes Formular-Schema; null = `CHECKIN_DEFAULT_SCHEMA`. Beim Einladen wird es aus dem `default_checkin_schema` des Coaches vorbefüllt (Migration 0150), damit Coach und Client dasselbe Formular sehen; `saveDefaultCheckinSchema` stempelt es zusätzlich auf bestehende Zeilen. Coach-Review und Client lösen bei null beide auf `CHECKIN_DEFAULT_SCHEMA` auf (nur Self-Coaching nutzt das eigene Default).
- `support_status` (text, nullable: 'open'|'in_progress'|'resolved'), `support_category` (text, nullable: 'feature_request'|'bug'|'question')
- `archived` (boolean, default false), `archived_at` (timestamptz, nullable)

Sonderfälle und RLS:

- **Support-Ticket** (Migrationen 0085/0086): eine Zeile mit id-Präfix `support_` zwischen User (`client_id`) und Admin (`coach_id`), die `support_status`/`support_category` trägt und die bestehende Coaching-Chat-/Realtime-Infrastruktur wiederverwendet (kein neuer Client-Code). Verwaltet über `open_support_chat`/`set_support_status`/`archive_support_ticket`/`delete_support_ticket`/`get_support_chats`/`get_archived_support_chats`/`get_user_support_chats`.
- **Self-Coaching:** eine Zeile mit `coach_id == client_id` (id-Präfix `self_`) bedeutet „be your own coach". Sie wird aus allen Coach-/Client-Listen herausgefiltert (`get_coach_info`, `get_coaching_clients`, `get_coach_clients_status`, `get_coach_checkin_status`) und ermöglicht das volle Coaching-Dashboard für die eigenen Daten.
- **RLS-Härtung (Migration 0125):** Die INSERT-Policy verlangt `status='pending' AND coach_id<>client_id` (ein Coach kann sich keine *aktive* Beziehung zu fremden Accounts mehr selbst anlegen), UPDATE-Policies haben `WITH CHECK`, und der Trigger `zane_coaching_guard_update` macht `coach_id`/`client_id` unveränderlich und erlaubt nur dem Client den Status-Wechsel (pending→active). `find_user_by_email` ist nicht mehr direkt für `anon`/`authenticated` ausführbar (nur intern via `invite_client`).
- **Migration 0137 (Audit A2):** die INSERT-Policy „coach can invite" ist entfernt und der direkte `INSERT`-Grant auf `zane_coaching` für `anon`/`authenticated` entzogen. Coaching-Zeilen entstehen ausschließlich über die SECURITY-DEFINER-RPCs (`invite_client`/`enable_self_coaching`/`open_support_chat`/`admin_broadcast_message`), sodass niemand mehr per Direkt-POST beliebige Pending-Einladungen (Spam) anlegen kann.

### `zane_coaching_threads`

- `id` (text), `coaching_id` (text), `name` (text), `created_by` (uuid), `created_at` (timestamptz)

### `zane_coaching_notes`

- `id` (text), `coaching_id` (text), `author_id` (uuid), `thread_id` (text, nullable → references `zane_coaching_threads`), `type` (text: session|plan|general|change), `entity_id` (text, nullable), `entity_name` (text, nullable), `body` (text), `created_at` (timestamptz), `read_at` (timestamptz, nullable)
- `attachments` (jsonb, nullable): `[{ url, name, type }]` image attachments; uploaded to the public `chat-attachments` storage bucket; rendered as thumbnails in the ChatThread + support-ticket bubbles. Migration 0104.

### `zane_coaching_macros`

- `id` (text), `coaching_id` (text), `set_by` (uuid), `set_at` (timestamptz), `calories_training` (int), `protein_training` (int), `carbs_training` (int), `fat_training` (int), `calories_rest` (int), `protein_rest` (int), `carbs_rest` (int), `fat_rest` (int)
- **RLS** (Migration 0149): beide Policies (`Coach can manage macros`, `Client can read macros`) verlangen `status='active'` und `id NOT LIKE 'support_%'`. Kein Schreiben/Lesen auf pending Invites (Write-before-consent) oder Support-Threads. Self-Coaching läuft weiter (self-Zeilen sind aktiv, `coach_id = client_id`).

### `zane_checkins`

- `id` (text), `coaching_id` (text), `client_id` (uuid), `week_start` (date), `checked_in_at` (timestamptz)
- **RLS**: `checkins_client` (Client liest/schreibt eigene, `client_id = auth.uid()`), `checkins_coach_read` (Coach liest die seiner aktiven Clients; seit Migration 0149 mit `coach_id <> client_id` + `id NOT LIKE 'support_%'`, analog zu den übrigen Coach-Read-Policies). Self-Coaching liest die eigenen Check-ins über `checkins_client`.
- `responses` (jsonb, nullable): all field values keyed by field key, primary storage since Migration 0065
- `weight_today` (numeric), `weight_avg_last_week` (numeric), `off_plan_notes` (text), `hydration_ml` (int), `days_trained` (int), `performance_vs_last_week` (text: worse|same|improved), `steps` (int), `cardio_minutes` (int), `cardio_distance_m` (int), `cardio_pace_feeling` (int 1-6), `cardio_effort` (int 1-10), `goal_note` (text), `hunger` (int), `sleep_quality` (int), `life_stress` (int), `work_stress` (int), `tiredness` (int), `issues_notes` (text), `general_note` (text)
- UNIQUE (coaching_id, week_start)

### `zane_glucose_logs`

- `id` (text), `user_id` (uuid), `date` (text, YYYY-MM-DD), `time` (text, HH:MM, lokale Uhrzeit der Messung), `value_mmol` (numeric: immer in mmol/L gespeichert; Anzeige-Einheit ist ein per-User-Setting), `context` (text: 'fasted'|'fed'|'other'), `note` (text, nullable), `created_at` (timestamptz)
- Store field: `store.glucoseLogs`. Mehrere Messungen pro Tag möglich. Wird direkt via Supabase aus der Glucose-Sektion des DailyLogSheet geschrieben (kein syncStore-Diff). Migration 0101.

### `zane_cardio_logs`

- `id` (text), `user_id` (uuid), `date` (text, YYYY-MM-DD), `type` (text, nullable), `duration_minutes` (int), `distance_m` (numeric, nullable), `pace_feeling` (int 1-6, nullable), `effort` (int 1-10, nullable), `note` (text, nullable), `created_at` (timestamptz)
- `session_id` (text, nullable): verknüpft einen Cardio-Log, der als Teil einer Training-Session geloggt wurde, mit seiner `zane_sessions`-Zeile

### `zane_cardio_plans`

- `id` (text), `user_id` (uuid), `name` (text), `activity_type` (text: 'running'|'walking'|'cycling'|'swimming'|'rowing'|'elliptical'|'hiking'), `archived` (boolean, default false), `mode` (text: 'manual'|'goal'), `created_at` (timestamptz)
- `days` (jsonb: `{ mon: true, wed: true, ... }`)
- `manual_targets` (jsonb, nullable: `{ mon: { target_type, distance_m, duration_minutes }, ... }`)
- `goal` (jsonb, nullable: `{ type: 'distance'|'pace', target_distance_m, target_duration_minutes }`), `goal_due_date` (date, nullable)
- `start_fitness` (jsonb, nullable: `{ distance_m, duration_minutes, pace_s_per_km }`)
- `generated_weeks` (jsonb, nullable: Array von `{ distance_m, duration_minutes, pace_s_per_km }`, indiziert nach Woche)
- `plan_start_date` (date, nullable: Start des Goal-Plans)
- Store field: `store.cardioPlans` (camelCase-Mapping). Migration 0094.

### `zane_daily_logs`

Eine Zeile pro Tag, Quelle für den Health-Tab. UNIQUE (user_id, date). Migration 0069.

- `id` (text), `user_id` (uuid), `date` (text, YYYY-MM-DD), `weight` (numeric, nullable), `steps` (int, nullable), `calories` (int, nullable), `protein` (int, nullable), `carbs` (int, nullable: immer **total** carbs), `fat` (int, nullable), `water_ml` (int, nullable), `note` (text, nullable), `created_at` (timestamptz)
- `fiber` (int, nullable): nur im Net-Carb-Modus gesetzt; Kalorien dann = `(protein + carbs - fiber)×4 + fat×9`. Migration 0073.
- `adherence` (numeric, nullable): Makro-Adherence-% persistiert **zum Speicherzeitpunkt**; auf Total-Carbs gerechnet, fiber beeinflusst sie nicht.
- `targets_snap` (jsonb, nullable): `{ protein, carbs, fat, calories, dayType }` Snapshot, damit eine spätere Target-Änderung nie vergangene Adherence umschreibt. `dayType` (`'training'`|`'rest'`) trägt zusätzlich den **Flex-Plan-Tagestyp-Override**: ein Flex-Plan hat keine programmierten Rest-Tage, `isTrainingDayForDate` default't ihn deshalb auf **rest** ("earn it") und zählt einen Flex-Tag nur als Training, wenn eine Session geloggt ist oder der User proaktiv Training gesetzt hat. Die Wahl sitzt auf einem kleinen **Training | Rest**-Slider (fa-dumbbell/fa-bed) im **Health-Tab-Header** (`HealthDateStrip`, mittig zwischen Kalender-Icon und LOG, nur Flex, ausgeblendet während eines Status-Tags oder sobald eine Session geloggt ist, nur im User-Tab via `setStore`-Prop). Er schreibt **sofort** in diese Spalte (ein inhaltsloser Rest-Override wird verworfen, da rest der Default ist; ein inhaltsloser Log lässt den "logged"-Marker im Header nie aufleuchten). `LB.flexDayTypeOverride(state, date)` liest ihn zurück. Cycle-/Weekday-Pläne behalten die optimistische "Plan wird befolgt"-Annahme (geplanter Trainingstag heute/zukünftig = training) und ignorieren den Flex-Override. Ein **zweiseitiger Daily-Log-Heal** (`screens-health.jsx`) gleicht vergangene Tage ab: **Downgrade** training→rest, wenn ein training-getaggter Tag keine Session hatte (Cycle/Week: geplanter Tag geskippt, oder Flex: proaktives Training nicht durchgeführt), und **Upgrade** rest→training (alle Modi), wenn ein rest-getaggter Tag eine geloggte Session bekam (inkl. Freestyle-Session an einem Rest-Tag); die beiden Mengen sind disjunkt, es gibt also keine Oszillation.
- `off_plan_note` (text, nullable): täglicher Off-Plan-Hinweis; store field `offPlanNote`; `dailyLogsWeekPrefill` akkumuliert alle Tages-Notizen mit "DD.MM.YYYY - "-Präfix in `off_plan_notes`. Migration 0079.
- `daily_coach_fields` (jsonb, nullable): beliebige key→value-Map für coach-konfigurierte tägliche Tracking-Felder; Keys matchen `checkin_schema`-Feld-Keys mit `show_in_health_log: true`. Store field `coachFields`. Migration 0078.
- `updated_at` (timestamptz, default now()): Staleness-Guard für den Multi-Device-Upsert; store field `updatedAt`, bei jedem Save gesetzt. Migration 0096.

Sync-Verhalten:

- **Sync via `sync_daily_logs_batch`-RPC** (kein plain Upsert): löst Konflikte auf (user_id, date) unter Beibehaltung der bestehenden id und überschreibt nur, wenn das eingehende `updated_at` neuer ist. So kollidieren zwei Geräte, die denselben Tag loggen, nicht auf UNIQUE(user_id, date), und ein staler Offline-Edit kann keinen neueren Stand clobbern (Migration 0096).
- Der Cache-first-Merge in `app.jsx` dedupliziert Daily Logs zusätzlich **per Datum** (Server gewinnt), damit eine vor der RPC entstandene divergente id nicht als doppelter Tag erscheint.
- RLS: eigene Zeilen + Coach-of-Client-Reads (so füllt `loadClientStore` das `clientStore.dailyLogs` für den Coach-„Daily"-Tab, keine extra RPC).

### `zane_skips`

- `id` (text), `user_id` (uuid), `date` (text), `day_id` (text), `day_name` (text), `skip_reason` (text), `skipped_at` (timestamptz)

### `zane_status_periods`

Historie der Sick/Vacation/Deload-Phasen. Store field: `store.statusPeriods`. Migration 0083.

- `id` (text), `user_id` (uuid), `mode` (text: 'sick'|'vacation'|'deload'), `started_at` (timestamptz), `ended_at` (timestamptz, nullable: null = aktuell aktiv)
- **Deload** (Migration 0108, Overlay-Modell) nutzt diesen Mechanismus mit `mode='deload'`: der Cycle läuft normal weiter, aber `buildSeedSets` befüllt Lasten mit ~50% vor (via `window.__DELOAD`-Global, gespiegelt aus `statusMode` in `app.jsx`), der Home-Strip-Titel zeigt `DELOAD`, der Training-Header ein `DELOAD · 50%`-Badge, und geloggte Sessions werden `is_deload` geflaggt. Start/Ende via `LB.startDeload`/`LB.endDeload`; endet automatisch nach einem Cycle/einer Woche (bzw. für Flex: dem Wochen-Session-Ziel an Deload-Sessions) via `LB.deloadElapsed`, geprüft auf dem Home-Screen. Die Plan-Tab-Karte hat den Toggle-Button; ein 8-Wochen-Nudge (verankert an `deload_prompt_dismissed_at`) bietet einen Deload an.
- RLS: eigene Zeilen + Coach-of-Client-Reads (Migration 0084, damit `computeWeeklyAdherence` Sick-/Vacation-Tage aus dem Trainings-Adherence-Score des Clients ausschließen kann).
- Spiegel von `zane_user_settings.status_mode`/`status_mode_since` (das ist der schnelle Current-State-Cache; diese Tabelle ist die volle Historie für Stats). Genutzt von den StatsTab-Konsistenzkarten "Missed Workouts" / "Of Which Sick/Away". Geschrieben von `openStatusPeriod`/`closeStatusPeriod`/`updateStatusPeriodStart` in `store.js`.

### `zane_user_settings`

Eine Zeile je User. Neue Settings immer an den drei Stellen in `store.js` ergänzen (siehe CLAUDE.md, Abschnitt „Store").

Basisspalten: `user_id` (uuid), `active_schedule_id` (text), `cycle_index` (int), `cycle_start_date` (text), `last_advanced_date` (date), `week_plan_start_date` (date), `in_progress_session_id` (text), `unit` (text), `rest_default`/`rest_big`/`rest_medium`/`rest_small` (int), `push_enabled` (boolean), `pushover_user_key` (text), `cycle_week_view` (boolean), `accent_color` (text), `dark_mode` (text), `tempo_enabled` (boolean), `tempo_eccentric` (numeric), `tempo_concentric` (numeric), `smart_progression` (boolean), `progression_range_top` (int), `equipment_config` (jsonb), `custom_day_types` (text[]), `reminder_enabled` (boolean), `reminder_time` (text, HH:MM), `next_reminder_at` (timestamptz), `show_warmup_in_summary` (boolean), `show_coaching_tab` (boolean), `be_your_own_coach` (boolean), `session_timeout_minutes` (int, default 90)

**RLS:** eigene Zeile voll (`FOR ALL`) · ein aktiver Coach (`zane_is_coach_of`) darf eine Client-Zeile lesen, updaten **und** inserten (Migration 0163; die INSERT-Policy fehlte ursprünglich als einzige der Coach-Client-Tabellen, obwohl `syncStore`s `upsert()` sie auch für den reinen Update-Fall braucht, Postgres prüft bei `ON CONFLICT DO UPDATE` immer erst die INSERT-Policy). Praktisch relevant für Coach-Writes wie „Push to client" (`PlanViewerScreen`), die `active_schedule_id`/`cycle_index`/`cycle_start_date`/`week_plan_start_date` fürs Aktivieren eines Plans setzen.

Weitere Spalten:

- `use_pushover` (boolean, default false): wenn true und ein `pushover_user_key` gesetzt ist, gehen Rest-Timer-Notifications via Pushover statt Web Push. Store field `usePushover`. Migration 0081.
- `auto_close_notify` (jsonb, nullable): `{ dayName, date, durationMinutes }`, von der Edge Function geschrieben, von der App beim ersten Lesen gecleart.
- `macro_targets` (jsonb, nullable): persönliche Health-Tab-Targets `{ proteinTraining, carbsTraining, fatTraining, caloriesTraining, proteinRest, carbsRest, fatRest, caloriesRest }`. Store field `macroTargets`.
- `show_health_tab` (boolean, default false): pinnt den Health-Tab. Store field `showHealthTab`.
- `onboarding_completed` (boolean, default false): gesetzt nach Welcome-Tour oder erster Session. Store field `onboardingCompleted`.
- `net_carbs` (boolean, default false): Health-Tab-Carb-Modus, Net-Carb-Tracking ergänzt ein Fiber-Feld. Store field `netCarbs`. Migration 0073.
- `status_mode` (text, nullable: 'sick'|'vacation'|'deload'): schneller Current-State-Cache des aktiven Status-Modus. Store field `statusMode`. Migration 0082, 'deload' ergänzt in 0108.
- `status_mode_since` (timestamptz, nullable): Start des aktuellen Status-Modus. Store field `statusModeSince`. Migration 0082.
- `deload_prompt_dismissed_at` (timestamptz, nullable): Anker für den 8-Wochen-Deload-Nudge; gebumpt, wann immer der Prompt gezeigt/beantwortet wird. Store field `deloadPromptDismissedAt`. Migration 0108.
- `active_cardio_plan_id` (text, nullable): id des einen aktuell aktiven Cardio-Plans; nur dieser erscheint auf dem Home-Widget und befüllt Cardio-Logs vor. Store field `activeCardioPlanId`; neue Pläne werden bei Anlage auto-aktiviert. Migration 0095.
- `show_regression` (boolean, default true): wenn false, ist das Regression-Overlay im Training-Screen unterdrückt. Store field `showRegression`. Migration 0100.
- `glucose_unit` (text, default 'mmol'): Anzeige-Einheit für Blutzucker, 'mmol' = mmol/L, 'mgdl' = mg/dL; Werte in `zane_glucose_logs` sind immer in mmol/L gespeichert. Store field `glucoseUnit`. Migration 0101.
- `weight_fill_down` (boolean, default true): wenn true, füllt das Editieren eines Set-Gewichts im Training dasselbe Gewicht in nachfolgende noch nicht erledigte Working-Sets. Store field `weightFillDown`.
- `manual_calories` (boolean, default false): Health-Tab-Modus, Kalorien direkt eingeben statt aus Makros ableiten. Store field `manualCalories`.
- `default_checkin_schema` (jsonb, nullable): wiederverwendbares Default-Check-in-Formular-Schema eines Coaches, angewandt auf neue Coaching-Beziehungen. Store field `defaultCheckinSchema`.
- `vip_background` (text, nullable): admin-vergebener dekorativer Background-Key; gesetzt via `set_user_vip_background`. Store field `vipBackground`. Migration 0103.
- `sw_version` (text, nullable): letzte SW-Cache-Version (z.B. `'v2.445'`), die dieses Gerät beim Boot gemeldet hat, direkt aus dem Cache Storage gelesen. Store field `swVersion`; lässt den Admin erkennen, ob ein User mit Bug-Report auf einem stalen Cache festhängt, ohne ihn nach den Settings fragen zu müssen. Migration 0123.

## RPCs & Realtime

### Feature-Grants & Admin

- **`check_active_users_access()`** → `boolean`: gibt true zurück, wenn der aufrufende User das `active_users`-Feature hat (Admin oder per `zane_feature_grants`)
- **`get_active_users_grants()`** → `TABLE(email text)`: listet alle Emails mit `active_users`-Grant (nur Admin)
- **`set_active_users_grant(p_email text, p_granted boolean)`** → `void`: erteilt oder entzieht den `active_users`-Grant (nur Admin)
- **`get_all_users_admin()`** → `TABLE(user_id uuid, name text, email text, sw_version text, created_at timestamptz, approved boolean, plan_count int)`: alle registrierten Accounts (nur Admin, hardcoded auf `office@btc-prime.biz`, unabhängig vom `active_users`-Feature-Grant); die einzige Datenquelle des „All users"-Screens im Admin-Sheet (Settings). Der vereint die früheren separaten „Recent sign-ups"- und „Onboarded"-Ansichten als Client-seitige Filter (neue Sign-ups anhand `created_at`/localStorage `logbook-seen-signups`, Onboarded anhand `plan_count > 0`) plus Suche nach Name/Email und Filter „nur veraltete Version" (gegen die eigene, per Cache Storage ermittelte Version); deckt jeden Account ab, unabhängig von Aktivität. Migration 0123, `plan_count` in 0124.
- **`get_user_detail_admin(p_user_id uuid)`** → `jsonb` (nur Admin): volle Plan-Details eines Users (`active_schedule_id` + alle `plans` mit Tagen/Items inkl. aufgelöstem Übungsnamen/movement_type/unilateral) für die „All users"-Detailansicht beim Antippen einer Zeile.
- **`get_active_sessions_overview()`** → `TABLE(...)`: aktive + kürzlich beendete Sessions aller User inkl. Sets/Dauer-Statistik (gated by feature grant)
- **`get_active_session_detail(p_user_id uuid, p_session_id text)`** → `TABLE(...)`: Volldetail einer Session inkl. Historienvergleich (avg. Dauer, Sets, letzte Session; gated by feature grant). Gibt zusätzlich die `unit` ('kg'|'lbs') des Trainierenden zurück (Migration 0068), damit die Coach-Spectator-/Comparison-Ansicht Gewichte im Einheiten-Label des Clients zeigt; gespeicherte Zahlen werden nie umgerechnet.

### Signup & Approval

- **`get_signup_config()`** → `TABLE(requires_approval boolean, auto_approve_remaining int)` / **`set_signup_requires_approval(p_value boolean)`** → `void` (setzt den Master-Toggle, löscht dabei jedes Batch-Budget) / **`set_auto_approve_budget(p_count int)`** → `void` (öffnet die Registrierung für `p_count` Signups, danach Selbst-Sperre; `p_count ≤ 0` sperrt sofort): alle nur Admin. **`get_signup_requires_approval()`** → `boolean` existiert weiter (Legacy). **`signup_default_approved()`** → `boolean` (SECURITY DEFINER) ist die invertierte Flag und dient als Column-Default für `zane_profiles.approved`; **`signup_consume_budget()`** ist die Trigger-Funktion (AFTER INSERT auf `zane_profiles`), die das Budget runterzählt und bei 0 wieder zusperrt.
- **`get_recent_signups(p_limit int default 50)`** → `TABLE(user_id uuid, name text, email text, created_at timestamptz, approved boolean)`: jüngste Registrierungen (approved + pending) für den Admin-„Recent sign-ups"-Feed im Account-Tab (nur Admin). „Got it"-Dismiss pro Gerät via localStorage `logbook-seen-signups`. Migration 0075.
- **`get_pending_users()`** → `TABLE(user_id uuid, name text, email text, created_at timestamptz)` / **`approve_user(p_user_id uuid)`** → `void` / **`decline_user(p_user_id uuid)`** → `void` (löscht das Profil): Approval-Workflow für die Registrierungs-Freigabe, wenn `signup_requires_approval` an ist (alle nur Admin). **`get_users_with_plans()`** → `TABLE(user_id, name, email, joined_at, approved, plan_count)` ist die **Legacy**-„Onboarded"-Ansicht (nur User mit ≥1 Plan); von `get_all_users_admin` abgelöst, aber noch vorhanden.

### Sync-RPCs (Staleness-Guards)

- **`sync_sets_batch(p_sets jsonb)`** → `void`: Batch-Upsert für Sets mit `updated_at`-Guard; updated eine Zeile nur, wenn das eingehende `updated_at` neuer ist als das gespeicherte (verhindert, dass stale kbApply-Writes fertige Sets überschreiben).
- **`sync_daily_logs_batch(p_logs jsonb)`** → `void` (SECURITY INVOKER): Batch-Upsert für Daily Logs, löst Konflikte auf (user_id, date) unter Beibehaltung der bestehenden id, mit `updated_at`-Staleness-Guard. Ersetzt den plain Upsert, damit Multi-Device-Edits desselben Tages nicht auf UNIQUE(user_id, date) kollidieren und ein staler Write keinen neueren überschreibt. Migration 0096.
- **`sync_meso_states_batch(p_states jsonb)`** → `void` (SECURITY INVOKER): Batch-Upsert für Meso-States mit `updated_at`-Staleness-Guard, damit zwei Geräte, die denselben Meso-Plan trainieren, sich nicht still gegenseitig `deltas`/`joint_flags`/`weight_boosts`/`growth_counts`/`rep_miss_counts` clobbern. Migration 0122 (`growth_counts` ergänzt in 0130, `started_at` in 0138: beim Update COALESCEd, damit ein älterer Client, der es weglässt, den Anker nicht nullen kann; `rep_miss_counts` ergänzt in 0165).

### Session-Daten & History-Aggregate

- **`zane_entries_json(p_session_id text)`** → `jsonb` (SECURITY DEFINER, **internal-only**): baut das store-förmige (camelCase) `entries`-Array einer Session aus den relationalen Tabellen (`zane_session_entries`/`zane_sets`). Quelle der Wahrheit seit Migration 0058; von `get_active_session_detail`/`get_active_sessions_overview` genutzt, damit die Coach-/Spectator-Ansicht nicht mehr vom Legacy-JSONB abhängt. **Kein Client-Rollen-Grant** (Migration 0136): die Funktion filtert nur nach `session_id` ohne Owner-/Coach-Check, ein direkter Aufruf wäre also ein Cross-Tenant-Read (IDOR). `EXECUTE` ist für `anon`/`authenticated`/`PUBLIC` entzogen; die definer-owned Reporting-RPCs rufen sie intern trotzdem auf (laufen als Owner). Der Client schreibt das JSONB nicht mehr (`sessionToRow` in `store.js` lässt `entries` aus). Gibt seit Migration 0134 zusätzlich `plannedRepsMax` und seit 0135 `plannedProgressionOffset` zurück.

Serverseitige History-Aggregate (Migrationen 0059/0060, SECURITY INVOKER, optional `p_user_id` für Coach-Zugriff):

- **`get_exercise_best_e1rm(p_user_id?)`** → `TABLE(ex_id, best_e1rm)`: bestes All-Time-e1RM (Epley) je Übung über beendete Sessions. Beim Boot geladen und als `store.exerciseBests` gecacht; `bestE1rmForExercise` = max(Aggregat, lokal geladenes Fenster). Beim Training-Mount refresht (`refreshExerciseBests`). Assisted-Übungen (`movement_type = 'assisted'`, negative Last) sind ausgeschlossen (Migration 0148), sonst würde ein negatives „best e1RM" gecacht; ihre PR-Erkennung läuft ohnehin über `bestAssistLoad`/`bestTimeForExercise`.
- **`get_exercise_history(p_ex_id, p_day_id?, p_limit?, p_user_id?)`** → `TABLE(session_id, day_id, date, ended, sets jsonb)`: jüngste beendete Sessions mit dieser Übung. Genutzt von `fetchSeedEntries` (Seeds/Progression beim Session-Start, nur wenn das lokale Fenster < 3 Treffer hat), der „Last time"-Karte im Training (Fallback) und beiden Exercise-History-Ansichten (lokal sofort, Server erweitert auf volle Historie).
- **`get_user_volume_stats(p_user_id?)`** → `TABLE(session_count, total_volume, total_minutes, total_done_sets)`: All-Time-Summen. Vom Client derzeit **nicht** aufgerufen: die Stats summieren lokal über `totalVolume()`/`doneSetCount()`, die für gefensterte Sessions auf die `get_session_stats`-Aggregate zurückfallen (exakt, offline-fähig, schließt frisch beendete Sessions sofort ein). Volumen-Semantik inkl. Assisted (Migration 0147) identisch zu `get_session_stats`.
- **`get_session_stats(p_user_id?)`** → `TABLE(session_id, exercise_count, done_sets, volume)`: per-Session-Aggregate aller beendeten Sessions (Migration 0060). Beim Boot geladen und als `aggVolume`/`aggDoneSets`/`aggExercises` an die Sessions gehängt; `totalVolume`/`doneSetCount` nutzen sie als Fallback für Sessions ohne geladene Sets (History-Liste, Best Session, Coach-Listen). Semantik = Client-Logik für beendete Sessions (done-Flag nicht erforderlich); `done_sets` zählt kg+reps-Sets **oder** Sets mit geloggter `time_sec`-Dauer (Migration 0146, Parität zu `doneSetCount`). Assisted-Übungen (`movement_type = 'assisted'`) zählen `GREATEST(0, Körpergewicht + kg) * reps` mit dem `zane_daily_logs`-Gewicht am nächsten zum Session-Datum, ohne geloggtes Gewicht `GREATEST(0, kg)` (Migration 0147, Parität zu `entryVolume`). `sessionToRow` filtert die `agg*`-Felder beim Sync wieder heraus.

### Coaching & Support

- **`get_coach_info()`** → `TABLE(coaching_id text, coach_id uuid, coach_email text, coach_name text, status text)`: gibt die Coach-Beziehung des aufrufenden Clients zurück (wer coacht mich); Self-Coaching-Zeilen ausgeschlossen.
- **`get_coaching_clients()`** → `TABLE(coaching_id text, client_id uuid, client_email text, client_name text, status text, checkin_enabled boolean)`: listet alle Clients des aufrufenden Coaches inkl. `checkin_enabled`-Flag; Self-Coaching-Zeilen ausgeschlossen.
- **`get_coach_clients_status()`** → `TABLE(client_id uuid, in_progress_session_id text)`: Live-Trainingsstatus aller aktiven Clients eines Coaches (SECURITY DEFINER, umgeht RLS auf `zane_user_settings`); Self-Coaching-Zeilen (`coach_id == client_id`) ausgeschlossen.
- **`get_coach_checkin_status()`** → `TABLE(coaching_id text, checked_in_at timestamptz)`: Check-in-Status je Coaching-Beziehung des aufrufenden Coaches für die zuletzt abgeschlossene Woche (`week_start` = Montag der Vorwoche); Self-Coaching- und Support-Zeilen ausgeschlossen. Die Wochenberechnung nutzt `EXTRACT(ISODOW)` (Mo=1..So=7), damit Sonntag als Tag 7 der laufenden Woche zählt und die „fällige" Woche erst am Montag weiterspringt, exakt wie `store.js checkinWeekStart()` (Migration 0149; vorher `DOW` mit So=0, was sonntags eine Woche zu früh sprang und einen bereits eingecheckten Client fälschlich auf „CHECK-IN DUE" zurückflippte).
- **`invite_client(p_email text)`** → `text` (SECURITY DEFINER): Coach lädt einen Client per Email ein; legt eine `pending`-Zeile (id-Präfix `cch_`) an und gibt deren id zurück. Seit Migration 0150 wird `checkin_schema` dabei aus dem `default_checkin_schema` des Coaches vorbefüllt (null bleibt null). Fehlerfälle als String: `ERROR:not_found` (Email unbekannt), `ERROR:self`, `ERROR:exists:<id>` (Beziehung existiert schon), `ERROR:already_coached` (Client hat bereits einen aktiven Coach). Beide Duplikat-Checks schließen seit Migration 0151 `support_%`-Zeilen aus (ein früherer Support-Chat ist keine Coaching-Beziehung), der `already_coached`-Check zusätzlich `coach_id = client_id` (Self-Coaching blockt keine echte Einladung durch einen anderen Coach).
- **`respond_to_coaching_invite(p_coaching_id text, p_accept boolean)`** → `void`: Client beantwortet eine Pending-Einladung. Accept: setzt `status='active'`, löscht dabei andere aktive Fremd-Coach-Beziehungen des Clients (Self-Coaching bleibt) und alle übrigen Pending-Einladungen. Decline: löscht die Zeile.
- **`find_user_by_email(p_email text)`** → `uuid` (STABLE SECURITY DEFINER, **internal-only**): case-insensitiver Lookup in `auth.users`. Kein direkter Grant für `anon`/`authenticated` (Migration 0125); wird nur intern von `invite_client` aufgerufen.
- **`enable_self_coaching()`** → `text`: legt (idempotent) eine Self-Coaching-Zeile an (`coach_id = client_id = auth.uid()`, status active, id-Präfix `self_`) und gibt deren id zurück. Aktiviert „be your own coach".
- **`admin_broadcast_message(p_body text)`** → `int` (nur Admin): sendet eine Nachricht an **alle** User auf einmal, indem für jeden User (der noch keins hat) ein Support-Ticket (`support_<user_id>`) angelegt und eine `zane_coaching_notes`-Zeile vom Admin eingefügt wird. Nutzt bewusst die bestehende, bereits überall ausgelieferte Support-/Realtime-Infrastruktur (kein neuer Client-Code nötig, erreicht auch User auf altem App-Stand) statt eines neuen Banner-Systems. Gibt die Anzahl benachrichtigter User zurück. Migration 0127. Admin-UI: Settings → Admin → „Message all users". **`get_support_chats()` blendet ein Ticket aus, solange der User selbst noch keine Nachricht geschickt hat** (Migration 0129): sonst würde ein Broadcast die Admin-Inbox mit einem Eintrag pro User fluten und echte offene Anfragen verdecken; taucht wieder auf, sobald der User antwortet.
- **Support-Tickets** (Migrationen 0085/0086, Archiv `archive_support_tickets`): ein Support-Ticket ist eine `zane_coaching`-Zeile mit id-Präfix `support_` (siehe Tabellen-Doku). RPCs: **`open_support_chat(p_category text default 'question')`** → `text` (User öffnet ein Ticket, `p_category` ∈ feature_request|bug|question, gibt die id zurück), **`get_user_support_chats()`** → `TABLE(...)` (die eigenen Tickets des Users inkl. `archived`/`unread_count`), **`get_support_chats()`** → `TABLE(...)` (Admin-Inbox offener Tickets; blendet Tickets ohne User-Nachricht aus, Migration 0129), **`get_archived_support_chats()`** → `TABLE(...)` (Admin, archivierte Tickets), **`set_support_status(p_coaching_id, p_status)`** → `void` (Admin, open|in_progress|resolved), **`archive_support_ticket(p_coaching_id)`** / **`delete_support_ticket(p_coaching_id)`** → `void` (Admin).

### Sonstiges

- **`zane_is_coach_of(p_client_id uuid)`** → `boolean` (STABLE SECURITY DEFINER): RLS-Helfer, true wenn `auth.uid()` ein aktiver Coach des Clients ist (`zane_coaching` mit `status='active'`). Basis aller Coach-of-Client-Policies (Profiles, Exercises, Schedules, Sessions, Entries, Sets, Daily Logs, Status Periods). Seit Migration 0148 sind Support-/Broadcast-Zeilen (id-Präfix `support_`) ausgeschlossen (`and id not like 'support_%'`): ein Admin, der einen Support-Chat mit einem User teilt, bekommt dadurch keinen Coach-Zugriff auf dessen komplette Trainingsdaten mehr. Die Inline-Coach-Read-Policies auf `zane_cardio_logs`/`zane_status_periods`/`zane_glucose_logs` (die nicht über diese Funktion laufen) tragen dieselbe Exclusion.
- **`zane_coaching_notes_guard_update()`** → `trigger` (SECURITY DEFINER, Migration 0148): BEFORE-UPDATE-Guard auf `zane_coaching_notes`. Die „recipient can mark read"-UPDATE-Policy lässt sich per RLS nicht spaltenweise beschränken; der Trigger erlaubt einem Nicht-Autor daher nur, `read_at` zu ändern (jede andere Spaltenänderung wirft `recipient may only update read_at`). Kein direkter Grant.
- **`zane_guard_user_id_immutable()`** → `trigger` (SECURITY DEFINER, Migration 0148): BEFORE-UPDATE-Guard, wirft wenn sich `user_id` ändert. Auf `zane_exercises`/`zane_schedules`/`zane_sessions`/`zane_session_entries`/`zane_sets`/`zane_user_settings`, damit ein Coach eine Zeile nicht zwischen seinen Clients umhängen kann (die Coach-UPDATE-Policies haben kein OLD-fähiges `WITH CHECK`). Kein direkter Grant.
- **`handle_new_user()`** → `trigger` (SECURITY DEFINER): legt beim Anlegen eines Auth-Users die `zane_user_settings`-Zeile an (ON CONFLICT DO NOTHING); Trigger `on_auth_user_created` auf `auth.users`.
- **VIP-Backgrounds** (Migration 0103): **`get_user_vip_backgrounds()`** → `TABLE(email text, bg_key text)` (Admin, alle gesetzten Backgrounds) / **`set_user_vip_background(p_email text, p_bg_key text)`** → `text` (Admin, setzt `zane_user_settings.vip_background` für den User per Email; leerer Key = löschen).
- **`get_force_update_nonce()`** → `text` / **`admin_force_update()`** → `void` (setzen/lesen nur `zane_app_config.force_update_nonce`, Admin-Setter): pusht das „New version available"-Update-Banner an **alle** verbundenen Clients, ohne dass ein `sw.js`-Cache-Bump nötig ist (der laut Deployment-Regeln nur auf ausdrückliche Aufforderung passiert, die meisten Deploys lösen also keinen Banner aus). `app.jsx`s `checkForceUpdate` pollt die Nonce im selben Rhythmus wie den bestehenden `sw.js`-Text-Versions-Check (`checkSwUpdate`) und vergleicht sie gegen den localStorage-Key `logbook-force-nonce-seen`, nach demselben „erstes Sichten = Baseline, kein Banner"-Prinzip, damit ein brandneues Gerät nie fälschlich ein Update angezeigt bekommt. Ein Klick auf „Update" führt über `applyUpdate`/`LB.clearCachesAndReload()` immer zu einem echten frischen Reload, unabhängig davon, ob wirklich ein neuer Service Worker existiert. Migration 0131. Admin-UI: Settings → Admin → „Force refresh all users". Daneben „Test update banner" (kein Server-Call, setzt nur lokal `updateAvailable=true` zum Testen der Banner-UI).
- **`admin_schema_inventory()`** → `jsonb` (STABLE SECURITY DEFINER, **internal/ops-only**): liefert das komplette Schema-Inventar für den wöchentlichen Drift-Check (`tools/check-db-live.cjs` via `.github/workflows/db-drift.yml`): alle public-Spalten (`information_schema`), je Funktion `has_function_privilege('anon', ...)` und die `supabase_realtime`-Publikation. Kein Grant für `anon`/`authenticated`, nur `service_role` (Aufruf per PostgREST mit dem Service-Key aus dem GitHub-Actions-Secret `SUPABASE_SERVICE_ROLE_KEY`). Migration 0142.
- **`auto-close-sessions`** (Edge Function): schließt abgelaufene offene Sessions. Keine Sets → Session + Entries löschen (butt start); mit Sets → `ended` = letztes `updated_at` der Sets, `duration_minutes` berechnen, `in_progress_session_id` clearen; optional Pushover-Notification. Wird per Cron alle 15 Minuten aufgerufen (Supabase Dashboard → Edge Functions → Schedule). Timeout pro User in `session_timeout_minutes` (default 90 min).

### Grant-Fallen bei neuen SECURITY-DEFINER-Funktionen

**Falle 1 (PUBLIC-Vererbung):** Postgres vergibt beim `CREATE FUNCTION` automatisch `EXECUTE` an die Pseudo-Rolle `PUBLIC`; davon erbt auch `anon`, **unabhängig** von einem gezielten `REVOKE ... FROM anon` (das war der Fehler in Migration 0125, korrigiert in 0128). Jede neue SECURITY-DEFINER-Funktion braucht explizit `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC` + `GRANT EXECUTE ON FUNCTION ... TO authenticated` (Ausnahme: rein intern aufgerufene Funktionen wie `find_user_by_email` bekommen kein Grant für `authenticated`).

**Falle 2 (Default Privileges, Migration 0132):** Zusätzlich zur PUBLIC-Vererbung existierte auf diesem Projekt eine `ALTER DEFAULT PRIVILEGES`-Regel (Rolle `postgres`, Schema `public`), die `anon` bei **jeder neu erstellten** Funktion automatisch einen direkten `EXECUTE`-Grant gab. Das ist ein expliziter Grant an `anon` selbst, kein geerbter über PUBLIC, und wird von `REVOKE ... FROM PUBLIC` **nicht** mitentfernt. Entdeckt an den beiden Migration-0131-Funktionen, die trotz korrektem `REVOKE FROM PUBLIC` weiterhin von `anon` ausführbar waren (verifiziert mit `has_function_privilege('anon', ...)`), während alle vorher existierenden Funktionen korrekt gesperrt waren. Migration 0132 hat die Default-Privileges-Regel für die Rolle `postgres` entfernt (Root Cause, schützt alle künftigen Funktionen) und zusätzlich explizit `REVOKE EXECUTE ... FROM anon` auf die beiden betroffenen Funktionen gesetzt. (Die gleiche Default-Privileges-Regel existiert auch für die Rolle `supabase_admin`, die vom Projekt aber nicht änderbar ist: „permission denied to change default privileges"; der tatsächlich genutzte Migrationspfad läuft nachweislich als `postgres` und ist gefixt.)

**Kontrolle nach jeder neuen Funktion (DEFINER wie INVOKER):** `SELECT has_function_privilege('anon', 'public.<fn>(...)', 'execute');` muss `false` ergeben, außer für die bewusste Ausnahme `get_public_feature_map` (siehe Feature Map oben; login-freie Public-Seite braucht anon-Zugriff). Der wöchentliche Live-Check (`tools/check-db-live.cjs`) kennt diese Ausnahme über `EXPECTED_ANON_EXEC` und prüft sie in beide Richtungen (fehlt der Grant dort, schlägt der Check ebenfalls fehl).

**Nachtrag (Live-Audit Juli 2026, Migration 0141):** Das 0132-Audit hatte nur die SECURITY-DEFINER-Funktionen geprüft. Sieben ältere SECURITY-INVOKER-RPCs aus der Zeit vor 0132 (`get_exercise_best_e1rm`, `get_exercise_history`, `get_user_volume_stats`, `get_session_stats`, `sync_sets_batch`, `sync_daily_logs_batch`, `sync_meso_states_batch`) trugen live noch direkte anon-EXECUTE-Grants aus der alten Default-Privileges-Regel. Risiko gering (INVOKER + RLS: `auth.uid()` ist für anon NULL, Reads leer, Writes scheitern an `user_id`), aber die App ruft sie nie vor dem Login auf; Migration 0141 entzieht PUBLIC- und anon-Grants und behält `authenticated`.

### Realtime

`zane_coaching` und `zane_coaching_notes` sind in der `supabase_realtime`-Publikation: ermöglicht Live-Coaching-Einladungen und -Nachrichten. (Die Publikation enthält daneben `door_events` und `motion_events`: app-fremde Tabellen eines anderen Projekts im selben Supabase-Projekt, nirgends im Repo referenziert; ignorieren und nicht anfassen.) **Cross-Device Live-Sync laufender Sessions wurde entfernt** (der lokale Store ist die alleinige Quelle für eine laufende Session; ein Coach sieht die Live-Session eines Clients per Polling via `get_active_session_detail`, nicht über Realtime). `subscribeToChanges(userId, onCoachingNote, onCoachingInvite)` abonniert nur noch die Coaching-Tabellen.
