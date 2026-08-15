-- AI Coach opinion on a weekly check-in (Claude Haiku), the same "AI reads
-- the data a human coach would see and gives its take" idea as the Daily
-- Summary (migration 0224), applied to zane_checkins instead of
-- zane_daily_logs. Visible to BOTH the client and their coach identically,
-- since CheckInCard (screens-coaching-tabs.jsx) is the one shared render
-- function both sides already use unmodified.
--
-- Both columns are nullable, server-authored only (written by the new
-- ai-checkin-opinion Edge Function via a service-role upsert), never by the
-- client's own submitCheckin upsert. Unlike zane_daily_logs there is no
-- batch-sync RPC here to keep them out of (submitCheckin's plain upsert
-- already only ever writes the fields it itself constructs), so no
-- analogous "exclude from a column list" step is needed, just don't add
-- them to submitCheckin's own upsert object.
alter table zane_checkins
  add column ai_opinion text,
  add column ai_opinion_generated_at timestamptz;

comment on column zane_checkins.ai_opinion is
  'AI-generated (Claude Haiku) coach-style read on this check-in. Server-authored only, see ai-checkin-opinion Edge Function. null = never generated.';
comment on column zane_checkins.ai_opinion_generated_at is
  'When ai_opinion was generated. Doubles as the once-per-check-in gate: the Edge Function refuses to regenerate once set.';
