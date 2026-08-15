-- AI-generated "yesterday" health summary (Claude Haiku), one paragraph a
-- user can request once a day via a button on the Health tab's new card.
--
-- Both columns are nullable and deliberately absent from
-- sync_daily_logs_batch's ON CONFLICT DO UPDATE SET column list (see that
-- function, migration 0212): Postgres only overwrites columns explicitly
-- named there, so a client-driven edit to some OTHER field on the same day
-- (e.g. correcting yesterday's weight) can never clobber these two columns,
-- by construction. They are written ONLY by the ai-daily-summary Edge
-- Function (service-role upsert), never by the normal client sync path.
alter table zane_daily_logs
  add column ai_summary text,
  add column ai_summary_generated_at timestamptz;

comment on column zane_daily_logs.ai_summary is
  'AI-generated (Claude Haiku) short read on this day''s tracked data. Server-authored only, see ai-daily-summary Edge Function. null = never generated for this day.';
comment on column zane_daily_logs.ai_summary_generated_at is
  'When ai_summary was generated. Doubles as the once-a-day gate: the Edge Function refuses to regenerate for a day that already has one.';
