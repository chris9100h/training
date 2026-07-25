-- Comment-only follow-up to 0205/0209. The estimator gained one more input:
--
--   restRatioPct  rest day calories as a percentage of a training day. null
--                 means "follow the automatic split", which is also the hardest
--                 cycle on offer and therefore the slider's floor; 100 feeds
--                 both day types the same. The week's total is held fixed at
--                 any setting, so this only moves calories inside the week.
--
-- No schema change: macro_calc is jsonb and was always read and written whole.
-- The comment is deliberately no longer an inventory of the object's keys. It
-- went stale twice in two migrations, and a comment nobody can trust is worse
-- than one that names the single place the shape is actually maintained.

comment on column zane_user_settings.macro_calc is
  'Last inputs of the macro-target estimator, as one form-state object. Prefill only, the computed result lives in macro_targets. Written and read whole, never filtered by key. Current shape and the meaning of each field: docs/database.md, zane_user_settings.';
