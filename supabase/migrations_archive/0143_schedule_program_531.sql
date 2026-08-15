-- 5/3/1 program support. A schedule can be a named training program with its
-- own progression model instead of the generic history-based one.
--   program_type: '531' marks a Wendler 5/3/1 plan (NULL = a normal plan).
--   program_data (jsonb): config plus per-lift Training Maxes, e.g.
--     { "unit": "kg", "includeDeload": true,
--       "mainLifts": { "<exId>": { "tm": 100, "kind": "squat" } } }
--     kind is one of squat|bench|deadlift|ohp and drives the per-cycle TM bump
--     (upper +2.5kg/+5lb, lower +5kg/+10lb). During training every working
--     weight is round(pct * tm) off the current 4-week wave; the TM rises a
--     step each cycle when the AMRAP top set hits its required minimum reps.
ALTER TABLE public.zane_schedules
  ADD COLUMN IF NOT EXISTS program_type text,
  ADD COLUMN IF NOT EXISTS program_data jsonb;
