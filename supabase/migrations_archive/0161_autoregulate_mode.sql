-- Per-plan choice of WHAT an autoregulate-only plan tunes from feedback:
-- weight only, or both sets and weight. Only meaningful when
-- mesocycle_autoregulate is true; the bounded mesocycle always regulates both.
-- null = 'both' (default, backward-compatible with autoregulate plans created
-- before this column). 'load' = regulate weight only, keep set counts fixed.
-- Text (not a bool) so a future 'volume'-only mode needs no schema change; no
-- CHECK constraint, matching the app-side validation of the other plan-mode
-- columns (mesocycle_weeks, program_type).
alter table zane_schedules
  add column if not exists mesocycle_autoregulate_mode text;
