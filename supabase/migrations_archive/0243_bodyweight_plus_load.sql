-- Weighted bodyweight work: pull-ups with a belt, dips with a dumbbell.
--
-- Until now a bodyweight exercise had one binary choice, pull_bodyweight, which
-- only ever pre-filled the weight field with the user's last logged bodyweight.
-- Adding load meant doing the arithmetic yourself: you weigh 80, you hang 10 on
-- the belt, you type 90 and remember why.
--
-- This adds a third mode where you type the 10 and the app keeps the 90.
--
-- The split matters for what everything downstream sees. zane_sets.kg keeps
-- holding the TOTAL load, so e1RM, PR detection, volume and the whole
-- autoregulation engine carry on reading the same column with the same meaning
-- (90 kg really is what moved). added_kg records what was actually on the belt,
-- purely so the UI can show and re-edit that number instead of a total the user
-- never typed.
--
-- Storing both also freezes the bodyweight at logging time by construction:
-- bodyweight = kg - added_kg. Nothing recomputes against today's weigh-in, so
-- losing three kilos cannot retroactively rewrite last month's pull-up PR.

-- ── 1. Exercise: three-way mode ──────────────────────────────────────────────
-- Text rather than a second boolean: the three states are mutually exclusive,
-- and two booleans would allow a fourth, meaningless combination.
ALTER TABLE public.zane_exercises
  ADD COLUMN IF NOT EXISTS bodyweight_mode text;

ALTER TABLE public.zane_exercises
  DROP CONSTRAINT IF EXISTS zane_exercises_bodyweight_mode_check;
ALTER TABLE public.zane_exercises
  ADD CONSTRAINT zane_exercises_bodyweight_mode_check
  CHECK (bodyweight_mode IS NULL OR bodyweight_mode IN ('pull', 'plus_load'));

COMMENT ON COLUMN public.zane_exercises.bodyweight_mode IS
  'Bodyweight handling for equipment=bodyweight, log_mode=weight exercises. null = enter the weight manually, ''pull'' = pre-fill the last logged bodyweight, ''plus_load'' = type only the added load and let the app add bodyweight to it. Supersedes pull_bodyweight, which is still written in lockstep so clients on an older cached build keep working.';

UPDATE public.zane_exercises
   SET bodyweight_mode = 'pull'
 WHERE pull_bodyweight = true
   AND bodyweight_mode IS NULL;

-- ── 2. Set: what was actually added ──────────────────────────────────────────
ALTER TABLE public.zane_sets
  ADD COLUMN IF NOT EXISTS added_kg numeric;

COMMENT ON COLUMN public.zane_sets.added_kg IS
  'Load added on top of bodyweight for a plus_load exercise, in kg. kg still holds the TOTAL (bodyweight + added_kg) so every downstream calculation is unchanged; this column exists so the UI can show and re-edit the number the user actually typed. null on every other kind of set. Implied bodyweight at logging time = kg - added_kg.';
