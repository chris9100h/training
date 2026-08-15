-- Durable per-session autoregulation / mesocycle feedback recap.
-- Stores the feedback the lifter gave that session (soreness, joint, pump +
-- volume or weight-feel) together with the weight and set bumps or cuts it
-- earned, so the session detail screen can show it long after the session was
-- logged. Previously this only lived in device localStorage: lost on any other
-- device and cleared over time. JSONB shape is app-defined (see docs/database.md).
alter table public.zane_sessions
  add column if not exists meso_recap jsonb;
