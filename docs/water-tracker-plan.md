# Water Tracker Integration Plan (Wasser Tracker -> Zane)

Status: PROPOSAL, awaiting user approval. Nothing implemented yet.
Research base: full read of the Wasser Tracker (standalone PWA) + 6-agent map of the training repo.

## The one key insight (integration contract)

Zane already stores hydration: `zane_daily_logs.water_ml` (store field `dailyLogs[].waterMl`),
rendered in the Health "Water" card + chart, and it already feeds the coaching check-in
aggregate `hydration_ml`. There is a full water unit helper family in `ui.jsx`
(`UI.waterQuickAdds/waterToEntry/waterEntryToMl/waterSummaryValue/...`, ml canonical, fl oz for lbs users).

So the entire integration is: on every water entry add/delete, recompute the day's ml sum and
write it into `dailyLogs[date].waterMl` via the exact same store update the Health `save()` uses.
Then the Health card, Today card, CSV export, screenshots, and coaching hydration all "just work".

## What the source app does (feature inventory to reproduce)

- Daily goal (default 2000 ml) + start/end time window (08:00-22:00).
- Hero: today's total, goal, activity ring (or bar), win streak.
- Quick water tiles 250/500/1000/1500 (plain water, category=null).
- Other drinks: coffee (size + milk sub-flow), energy 250, whey 300, 500/650 glass, jug 1700 (category='other').
- Custom add: arbitrary ml + optional name (category='custom').
- Confirm-before-add modal; per-entry log list with delete; breakdown of other drinks + milk + custom.
- Bottle tracking: after 1500ml plain water, "bottle empty?" -> increment bottle count; current-bottle bar.
- Expected-vs-actual chart over the day with a "now" line.
- Reminder: linear expected ramp; nudge when behind >120ml (Pushover), last_push_sent throttle.
- Win streak + success modal; Stats sheet 7/30/90/custom: bar chart + KPIs.
- Own Supabase project: water_settings(id=1 singleton), water_logs, water_daily.

## Architecture decisions (recommendations)

- New table `zane_water_logs` (id, user_id, date, time, amount_ml, name, category, created_at),
  modeled on `zane_glucose_logs` (migration 0173/0101 shape), RLS self + coach-read, no realtime.
- Persistence: Model A (store collection `waterLogs`, synced through `syncStore` like `zane_cardio_logs`)
  -> free offline retry + boot merge (`mergeCollectionById`). Alternative: direct insert/delete like glucose.
- Config on `zane_user_settings`: `water_goal_ml`, `water_start_time`, `water_end_time` (4-site store.js wiring, backed up).
- Streak: DERIVE from `dailyLogs.waterMl >= goal` history (no stored streak state). Success modal via in-session flag.
- Bottle tracking: optional. If kept: 2 columns `water_bottles_today` + `water_bottles_date` (day-scoped, backup-allowlist).
- Screen: new `src/screens-water.jsx`, route `water`, kept under Health tab (tabActive water->health).
  Entry point: make the Health "Water" card tappable -> `go({name:'water'})`. Optional Home widget.
- Charts: hand-rolled inline SVG (no Chart.js in Zane). Ring = SVG circle. Line+now = mirror HealthLineChart. Stats = HealthBarChart.
- Design: Zane tokens, radius 6/8, water-blue (#4a9fe0) for liquid + var(--accent*) for chrome,
  Sheet + useConfirm for modals, no toasts, three-theme-safe, reuse UI.water* helpers, no em-dashes.
- Reminder: Phase 2 follow-up (clone `reminder` edge function -> `water-reminder` + cron migration).
  Reuses existing web-push/pushover transport. Ship UI + logging first.

## Concrete plan (file by file)

Phase 1 - Data layer
- `supabase/migrations/0180_water_tracker.sql`: create `zane_water_logs` (+ index + 2 RLS policies),
  ALTER `zane_user_settings` ADD water_goal_ml/water_start_time/water_end_time (+ optional bottle cols).
- `supabase/schema.sql`: snapshot the new table + columns + RLS.
- `docs/database.md`: add `### zane_water_logs` section (every column) + zane_user_settings cols + CLAUDE.md overview line.
- `src/store.js`: loadFromSupabase (map waterLogs + new settings), syncStore diff for waterLogs (cardio template)
  + settings 4-site, importFromBackup block, refreshHealthLogs. app.jsx boot merge + softRefresh lines.
- `tools/check-backup-coverage.cjs`: add zane_water_logs to BACKUP_ENUM + waterLogs:[{}] to sandbox backup.

Phase 2 - Screen
- `src/screens-water.jsx`: WaterScreen (hero+ring, tiles, drinks, custom, confirm, log list, breakdown,
  bottle, chart, streak, stats sheet). Register on window.Screens. Reuse UI.* + Sheet + useConfirm.
- `index.html` SOURCES: add 'src/screens-water.jsx' (after screens-health.jsx). `sw.js` ASSETS: add it.
- `app.jsx`: route case 'water', tabRoutes + tabActive water->health.
- `src/screens-health.jsx`: make the Water card tappable -> go({name:'water'}).
- The mutation helper: every add/delete updates waterLogs AND recomputes dailyLogs[date].waterMl (all fluids summed).

Phase 3 (optional/follow-up) - Reminder
- `supabase/functions/water-reminder/index.ts` (clone `reminder`), ramp math + throttle col.
- `supabase/migrations/0181_water_reminder_cron.sql`: cron.schedule('water-reminder','*/5 * * * *',...).
- Reuse push_enabled/usePushover/pushoverUserKey. Needs function deploy + pg_cron.

Release chores (only on explicit request): SW cache bump 2.634->2.635, What's New draft-first, Feature Map card + features.html ?v= lockstep.

## User must do
- Run migration 0180 in Supabase (and 0181 + deploy water-reminder function for Phase 3).

## Open decisions (my recommendation in brackets)
1. Persistence Model A vs B [A: store collection, robust].
2. Do coffee/energy/etc. count toward the Health water number? [Yes, matches source "Heute getrunken" = all fluids].
3. Reconcile manual Health water field vs auto-summed tracker [tracker authoritative on days with entries; manual stays fallback].
4. Keep bottle tracking? [Yes, 2 small columns].
5. Reminder in scope now or follow-up? [Follow-up; ship UI+logging first].
6. Entry point: tappable Health card only, or also a bottom tab? [Sub-screen off Health, no new tab].
